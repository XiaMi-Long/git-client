/**
 * @description
 *   管理公共选择框的展开、键盘导航、前缀查找、浮层定位和事件清理。
 * @workflow
 *   打开时定位当前选项并显示浮层，选定后通知组件更新，关闭或卸载时释放监听。
 * @changeLog
 *   - 2026-11-13: Created. 为项目选择框提供统一交互及弹窗内浮层管理。
 */
import { computed, nextTick, onScopeDispose, ref, watch } from "vue";

/** 选择框的文本选项，值沿用调用方已有的业务字符串。 */
export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

/** 交互逻辑只读取选项、当前值及禁用状态，不接管业务保存。 */
interface SelectDropdownProps {
  modelValue: string;
  options: readonly SelectOption[];
  disabled?: boolean;
}

// 菜单与窗口边缘留出空隙，长列表在浮层内部滚动。
const VIEWPORT_MARGIN = 8;
const TRIGGER_GAP = 5;
const MENU_MAX_HEIGHT = 280;
// 连续输入用于查找同一个前缀，停顿后下一字符重新开始查找。
const TYPEAHEAD_RESET_MS = 700;

/**
 * 创建一组独立的选择框状态，所有业务变更均由调用方回调完成。
 * @param props - 响应式的当前值、选项及禁用状态
 * @param selectOption - 用户确认一个新值后的通知方法
 * @returns 模板引用、展开状态、选项位置和交互方法
 * @reasoning 顶层浮层可以保留所在 dialog 的焦点关系，同时避免被容器裁剪或遮挡。
 * @changeLog
 * - 2026-11-13: Created. 统一选择框交互和浮层生命周期。
 */
export function useSelectDropdown(props: SelectDropdownProps, selectOption: (selectedValue: string) => void) {
  const trigger = ref<HTMLButtonElement | null>(null);
  const menu = ref<HTMLElement | null>(null);
  const opened = ref(false);
  const activeIndex = ref(-1);
  const selectedOption = computed(() => props.options.find((option) => option.value === props.modelValue));
  let positionFrame: number | null = null;
  let typeaheadTimer: ReturnType<typeof setTimeout> | null = null;
  let typedPrefix = "";
  let resizeObserver: ResizeObserver | null = null;
  let disposed = false;
  let listening = false;

  /**
   * 判断事件目标是否属于当前选择框，避免选项点击被当作外部点击。
   * @param target - 指针、焦点或滚动事件的目标
   * @returns 目标是否位于触发器或浮层内部
   */
  function containsTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Node)) {
      return false;
    }
    return !!trigger.value?.contains(target) || !!menu.value?.contains(target);
  }

  /**
   * 将浮层限制在当前窗口中，底部空间不足时向上展开。
   * @returns void
   */
  function positionMenu(): void {
    const button = trigger.value;
    const popup = menu.value;
    const canPosition = opened.value && button !== null && popup !== null;
    if (!canPosition || !button || !popup) {
      return;
    }

    // 1. 先限制宽度再测量内容，确保长分支名不会把菜单撑出窗口。
    const buttonBounds = button.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;
    const maximumWidth = Math.max(0, viewportWidth - VIEWPORT_MARGIN * 2);
    popup.style.minWidth = `${Math.min(buttonBounds.width, maximumWidth)}px`;
    popup.style.maxWidth = `${maximumWidth}px`;

    // 2. 根据实际内容和上下空间决定展开方向，弹窗内也使用窗口坐标。
    const spaceBelow = Math.max(0, viewportHeight - buttonBounds.bottom - TRIGGER_GAP - VIEWPORT_MARGIN);
    const spaceAbove = Math.max(0, buttonBounds.top - TRIGGER_GAP - VIEWPORT_MARGIN);
    const desiredHeight = Math.min(popup.scrollHeight, MENU_MAX_HEIGHT);
    const opensBelow = spaceBelow >= desiredHeight || spaceBelow >= spaceAbove;
    const availableHeight = opensBelow ? spaceBelow : spaceAbove;
    popup.style.maxHeight = `${Math.min(MENU_MAX_HEIGHT, availableHeight)}px`;
    const popupBounds = popup.getBoundingClientRect();
    const maximumLeft = viewportWidth - popupBounds.width - VIEWPORT_MARGIN;
    popup.style.left = `${Math.max(VIEWPORT_MARGIN, Math.min(buttonBounds.left, maximumLeft))}px`;
    popup.style.top = `${opensBelow ? buttonBounds.bottom + TRIGGER_GAP : Math.max(VIEWPORT_MARGIN, buttonBounds.top - TRIGGER_GAP - popupBounds.height)}px`;
    popup.style.visibility = "visible";
  }

  /**
   * 合并同一帧的滚动和窗口尺寸变化，菜单自身滚动不重新定位。
   * @param event - 可选的滚动或窗口变化事件
   * @returns void
   */
  function schedulePosition(event?: Event): void {
    if (event?.target instanceof Node && menu.value?.contains(event.target)) {
      return;
    }
    const canSchedule = opened.value && !disposed && positionFrame === null;
    if (!canSchedule) {
      return;
    }
    positionFrame = requestAnimationFrame(() => {
      positionFrame = null;
      positionMenu();
    });
  }

  /**
   * 焦点或指针移到其他控件时关闭，不抢走用户正在操作的新焦点。
   * @param event - 文档捕获到的指针或焦点事件
   * @returns void
   */
  function onOutsideInteraction(event: Event): void {
    if (!containsTarget(event.target)) {
      closeMenu();
    }
  }

  /**
   * 仅在展开期间监听外部操作和尺寸变化。
   * @param enabled - 是否正在展示菜单
   * @returns void
   */
  function setListeners(enabled: boolean): void {
    if (enabled === listening) {
      return;
    }
    listening = enabled;
    // 展开时才绑定全局事件，多个选择框不会在空闲期间反复处理文档操作。
    if (enabled) {
      document.addEventListener("pointerdown", onOutsideInteraction, true);
      document.addEventListener("focusin", onOutsideInteraction, true);
      document.addEventListener("scroll", schedulePosition, true);
      window.addEventListener("resize", schedulePosition);
      resizeObserver = new ResizeObserver(() => schedulePosition());
      if (trigger.value) {
        resizeObserver.observe(trigger.value);
      }
      return;
    }
    // 关闭时成对解绑，销毁和外部禁用也复用同一条清理路径。
    document.removeEventListener("pointerdown", onOutsideInteraction, true);
    document.removeEventListener("focusin", onOutsideInteraction, true);
    document.removeEventListener("scroll", schedulePosition, true);
    window.removeEventListener("resize", schedulePosition);
    resizeObserver?.disconnect();
    resizeObserver = null;
  }

  /**
   * 关闭浮层并清理输入前缀，只有用户确认或取消选择时才恢复触发器焦点。
   * @param restoreFocus - 是否将焦点恢复到原选择框
   * @returns void
   */
  function closeMenu(restoreFocus = false): void {
    // 1. 先移出浏览器顶层并释放监听，再交由 Vue 移除选项节点。
    if (menu.value && typeof menu.value.hidePopover === "function") {
      menu.value.hidePopover();
    }
    opened.value = false;
    setListeners(false);
    // 2. 清理异步任务，不能让关闭前的定位和查找影响下次展开。
    typedPrefix = "";
    if (typeaheadTimer !== null) {
      clearTimeout(typeaheadTimer);
      typeaheadTimer = null;
    }
    if (positionFrame !== null) {
      cancelAnimationFrame(positionFrame);
      positionFrame = null;
    }
    if (restoreFocus && !disposed) {
      trigger.value?.focus();
    }
  }

  /**
   * 更新视觉焦点并滚动到对应选项，保持 DOM 焦点在组合框触发器上。
   * @param optionIndex - 需要突出显示的选项位置
   * @param ensureVisible - 键盘导航时滚动选项，鼠标悬停时保留当前位置
   * @returns void
   */
  function highlightOption(optionIndex: number, ensureVisible = true): void {
    const option = props.options[optionIndex];
    if (!option || option.disabled) {
      return;
    }
    activeIndex.value = optionIndex;
    if (ensureVisible) {
      void nextTick(() => {
        const popup = menu.value;
        const optionElement = popup?.querySelector<HTMLElement>(`[data-option-index="${optionIndex}"]`);
        if (!popup || !optionElement) {
          return;
        }
        // 只滚动选项列表，不能因定位当前选项而滚动底层设置页或弹窗。
        const optionBottom = optionElement.offsetTop + optionElement.offsetHeight;
        if (optionElement.offsetTop < popup.scrollTop) {
          popup.scrollTop = optionElement.offsetTop;
        } else if (optionBottom > popup.scrollTop + popup.clientHeight) {
          popup.scrollTop = optionBottom - popup.clientHeight;
        }
      });
    }
  }

  /**
   * 显示当前值对应的菜单，优先使用浏览器顶层浮层避免被原生 dialog 遮挡。
   * @param initialIndex - 键盘导航指定的初始位置，默认优先选中项
   * @returns 菜单挂载与首次定位完成
   */
  async function openMenu(initialIndex?: number): Promise<void> {
    const firstEnabled = props.options.findIndex((option) => !option.disabled);
    const canOpen = !disposed && !props.disabled && firstEnabled !== -1;
    if (!canOpen) {
      return;
    }
    const selectedIndex = props.options.findIndex((option) => option.value === props.modelValue && !option.disabled);
    activeIndex.value = initialIndex ?? (selectedIndex === -1 ? firstEnabled : selectedIndex);
    opened.value = true;
    await nextTick();
    // 等待挂载期间可能被外部点击、禁用或卸载，旧请求不能重新打开菜单。
    const stillOpen = !disposed && opened.value && !props.disabled;
    if (!stillOpen || !menu.value) {
      return;
    }
    if (typeof menu.value.showPopover === "function") {
      menu.value.showPopover();
    }
    positionMenu();
    setListeners(true);
    highlightOption(activeIndex.value);
  }

  /**
   * 鼠标点击触发器时切换菜单状态。
   * @returns void
   */
  function toggleMenu(): void {
    if (opened.value) {
      closeMenu();
    } else {
      void openMenu();
    }
  }

  /**
   * 用户确认有效选项后仅提交变化的值，重复选择不触发业务保存。
   * @param optionIndex - 被点击或按 Enter 确认的选项位置
   * @returns void
   */
  function chooseOption(optionIndex: number): void {
    const option = props.options[optionIndex];
    const canChoose = !props.disabled && option !== undefined && !option.disabled;
    if (!canChoose || !option) {
      return;
    }
    if (option.value !== props.modelValue) {
      selectOption(option.value);
    }
    closeMenu(true);
  }

  /**
   * 循环移动到下一个可选项，跳过占位选项和其他禁用项。
   * @param direction - 1 为向后，-1 为向前
   * @returns void
   */
  function moveHighlight(direction: number): void {
    const optionCount = props.options.length;
    for (let offset = 1; offset <= optionCount; offset++) {
      const optionIndex = (activeIndex.value + direction * offset + optionCount) % optionCount;
      if (!props.options[optionIndex].disabled) {
        highlightOption(optionIndex);
        return;
      }
    }
  }

  /**
   * 按连续输入的标签前缀查找，重复同一字符时在匹配项中循环。
   * @param character - 用户输入的单个可打印字符
   * @returns 查找和菜单展开完成
   */
  async function findByPrefix(character: string): Promise<void> {
    // 1. 维护本次连续输入的前缀，停顿后重新开始查找。
    const normalizedCharacter = character.toLocaleLowerCase();
    typedPrefix += normalizedCharacter;
    if (typeaheadTimer !== null) {
      clearTimeout(typeaheadTimer);
    }
    typeaheadTimer = setTimeout(() => {
      typedPrefix = "";
      typeaheadTimer = null;
    }, TYPEAHEAD_RESET_MS);

    // 2. 从当前选项起查找，重复同一字符则依次跳到下一个匹配项。
    const repeatsCharacter = [...typedPrefix].every((typedCharacter) => typedCharacter === normalizedCharacter);
    const prefix = repeatsCharacter ? normalizedCharacter : typedPrefix;
    const currentIndex = opened.value ? activeIndex.value
      : props.options.findIndex((option) => option.value === props.modelValue);
    const startIndex = repeatsCharacter ? currentIndex + 1 : currentIndex;
    for (let offset = 0; offset < props.options.length; offset++) {
      const optionIndex = (Math.max(0, startIndex) + offset) % props.options.length;
      const option = props.options[optionIndex];
      const matchesPrefix = !option.disabled && option.label.toLocaleLowerCase().startsWith(prefix);
      if (matchesPrefix) {
        if (!opened.value) {
          await openMenu(optionIndex);
        } else {
          highlightOption(optionIndex);
        }
        return;
      }
    }
  }

  /**
   * 提供方向键、首尾、确认、取消和前缀查找，Tab 保留原有焦点移动。
   * @param event - 触发器或选项收到的键盘事件
   * @returns void
   */
  function onKeydown(event: KeyboardEvent): void {
    if (props.disabled || event.isComposing) {
      return;
    }
    // 1. 处理退出与取消，避免选择框的 Esc 同时关闭上层弹窗。
    if (event.key === "Tab") {
      // 保持单选控件的提交习惯，确认视觉焦点后仍由浏览器执行正常的 Tab 移动。
      if (opened.value) {
        chooseOption(activeIndex.value);
      }
      return;
    }
    if (event.key === "Escape") {
      // 只取消当前展开层，防止上层分支或 build 弹窗同时关闭。
      if (opened.value) {
        event.preventDefault();
        event.stopPropagation();
        closeMenu(true);
      }
      return;
    }

    const closesWithAlt = opened.value && event.altKey && event.key === "ArrowUp";
    if (closesWithAlt) {
      event.preventDefault();
      event.stopPropagation();
      chooseOption(activeIndex.value);
      return;
    }

    // 2. 先移动视觉焦点，仅在确认时更新调用方的值。
    const navigationKeys = ["ArrowDown", "ArrowUp", "Home", "End", "Enter", " "];
    if (navigationKeys.includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Enter" || event.key === " ") {
        if (opened.value) {
          chooseOption(activeIndex.value);
        } else {
          void openMenu();
        }
      } else if (event.key === "Home" || event.key === "End") {
        const enabledIndexes = props.options.map((option, index) => option.disabled ? -1 : index)
          .filter((index) => index !== -1);
        const optionIndex = event.key === "Home" ? enabledIndexes[0] : enabledIndexes[enabledIndexes.length - 1];
        if (optionIndex !== undefined) {
          if (opened.value) {
            highlightOption(optionIndex);
          } else {
            void openMenu(optionIndex);
          }
        }
      } else if (opened.value) {
        moveHighlight(event.key === "ArrowDown" ? 1 : -1);
      } else {
        void openMenu();
      }
      return;
    }

    // 3. 保留原生选择框的前缀查找习惯，不拦截系统组合快捷键。
    const printableCharacter = event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
    if (printableCharacter) {
      event.preventDefault();
      event.stopPropagation();
      void findByPrefix(event.key);
    }
  }

  // 选项异步更新或控件变为禁用时，不能保留指向旧选项的键盘焦点。
  watch(() => [props.modelValue, props.options, props.disabled] as const, () => {
    if (props.disabled) {
      closeMenu();
    } else if (opened.value) {
      const optionIndex = props.options.findIndex((option) => option.value === props.modelValue && !option.disabled);
      activeIndex.value = optionIndex === -1 ? props.options.findIndex((option) => !option.disabled) : optionIndex;
      if (activeIndex.value === -1) {
        closeMenu();
      } else {
        highlightOption(activeIndex.value);
        schedulePosition();
      }
    }
  });

  onScopeDispose(() => {
    disposed = true;
    closeMenu();
  });

  return { trigger, menu, opened, activeIndex, selectedOption, toggleMenu, onKeydown, chooseOption, highlightOption };
}
