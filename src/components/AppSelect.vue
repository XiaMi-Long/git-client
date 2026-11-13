<!--
  @component AppSelect
  @description
    公共单选控件，统一触发器和选项浮层的明暗主题、选中状态及键盘交互。
  @usage
    传入 v-model、options 和 aria-label；业务保存继续由 update:modelValue 的接收方完成。
  @dataFormat
    options 为包含 value、label 和可选 disabled 的数组，所有值均为字符串。
  @workflow
    点击或键盘展开 -> 定位当前选项 -> 确认后更新值并关闭，禁用和卸载时清理浮层。
  @changeLog
    - 2026-11-13: Created. 替换项目内原生 select，统一使用系统菜单样式。
-->
<script setup lang="ts">
import { useId } from "vue";
import { useSelectDropdown, type SelectOption } from "@/composables/useSelectDropdown";

const props = withDefaults(defineProps<{
  /** 当前选中的业务字符串，空字符串也可以作为有效选项。 */
  modelValue: string;
  /** 原有选项及顺序，disabled 用于保留不可选择的占位项。 */
  options: readonly SelectOption[];
  /** 禁止展开和选择，沿用调用场景已有的禁用条件。 */
  disabled?: boolean;
  /** 无匹配值时的展示文字，调用方按已有文案传入。 */
  placeholder?: string;
  /** 提供给辅助技术的控件名称。 */
  ariaLabel: string;
}>(), { disabled: false, placeholder: "" });

const emit = defineEmits<{
  /** 用户确认不同选项时通知调用方，沿用原有状态更新和保存流程。 */
  "update:modelValue": [selectedValue: string];
}>();

const menuId = `app-select-${useId()}`;
const {
  trigger, menu, opened, activeIndex, selectedOption,
  toggleMenu, onKeydown, chooseOption, highlightOption,
} = useSelectDropdown(props, (selectedValue) => emit("update:modelValue", selectedValue));
</script>

<template>
  <span class="app-select">
    <!-- 组合框焦点保留在触发器，视觉焦点通过 aria-activedescendant 关联选项 -->
    <button
      ref="trigger"
      class="app-select-trigger"
      :class="{ opened }"
      type="button"
      role="combobox"
      aria-haspopup="listbox"
      :aria-label="ariaLabel"
      :aria-expanded="opened"
      :aria-controls="opened ? menuId : undefined"
      :aria-activedescendant="opened && activeIndex >= 0 ? `${menuId}-${activeIndex}` : undefined"
      :disabled="disabled"
      :title="selectedOption?.label || placeholder"
      @click="toggleMenu"
      @keydown="onKeydown"
    >
      <span class="app-select-value">{{ selectedOption?.label || placeholder }}</span>
      <svg class="app-select-chevron" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m4.5 6 3.5 3.5L11.5 6" /></svg>
    </button>

    <!-- 原生顶层浮层可覆盖 dialog；不支持 Popover API 的环境仍按固定定位展示 -->
    <span
      v-if="opened"
      :id="menuId"
      ref="menu"
      class="app-select-menu"
      role="listbox"
      popover="manual"
      :aria-label="ariaLabel"
      @keydown="onKeydown"
      @click.stop
    >
      <button
        v-for="(option, index) in options"
        :id="`${menuId}-${index}`"
        :key="option.value"
        class="app-select-option"
        :class="{ selected: modelValue === option.value, highlighted: activeIndex === index }"
        :data-option-index="index"
        type="button"
        role="option"
        tabindex="-1"
        :aria-selected="modelValue === option.value"
        :disabled="option.disabled"
        :title="option.label"
        @mousedown.prevent
        @pointermove="highlightOption(index, false)"
        @click="chooseOption(index)"
      >
        <span class="app-select-option-label">{{ option.label }}</span>
        <svg v-if="modelValue === option.value" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m3.5 8 3 3 6-6" /></svg>
      </button>
    </span>
  </span>
</template>

<style scoped>
.app-select { display: inline-flex; min-width: 0; vertical-align: middle; color: var(--text); font: 12px var(--font); }
.app-select-trigger { display: inline-flex; align-items: center; gap: 10px; width: 100%; min-width: 0; height: 32px; padding: 0 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); outline: none; background: var(--surface); color: var(--text); font: inherit; text-align: left; cursor: pointer; transition: border-color 120ms ease, box-shadow 120ms ease; }
.app-select-trigger:not(:disabled):hover { border-color: var(--border-strong); }
.app-select-trigger:focus-visible, .app-select-trigger.opened { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-ring); }
.app-select-trigger:disabled { opacity: 0.5; cursor: default; }
.app-select-value { flex: 1; min-width: 0; overflow: hidden; color: inherit; font: inherit; text-overflow: ellipsis; white-space: nowrap; }
.app-select-chevron { flex-shrink: 0; color: var(--muted); }
.app-select-menu { position: fixed; inset: auto; z-index: 10000; width: max-content; margin: 0; padding: 4px; overflow: auto; overscroll-behavior: contain; visibility: hidden; border: 1px solid var(--border); border-radius: var(--radius-md); outline: none; background: var(--surface); color: var(--text); box-shadow: var(--shadow-pop); font: 12px var(--font); }
.app-select-option { display: flex; align-items: center; justify-content: space-between; gap: 20px; width: 100%; min-height: 32px; padding: 7px 10px; border: 0; border-radius: 6px; outline: none; background: transparent; color: var(--text); font: inherit; text-align: left; cursor: pointer; }
.app-select-option.highlighted { background: var(--hover); }
.app-select-option.selected { background: var(--accent-soft); color: var(--accent-strong); }
.app-select-option:disabled { opacity: 0.4; cursor: default; }
.app-select-option-label { flex: 1; min-width: 0; overflow: hidden; color: inherit; font: inherit; text-overflow: ellipsis; white-space: nowrap; }
.app-select-option > svg { flex-shrink: 0; }
</style>
