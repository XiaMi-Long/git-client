<!--
  @component CommitSearchBox
  @description
    显示提交搜索框、已选作者汇总和近半年作者多选选项。
  @usage
    主列表和分支预览分别传入自己的 useCommitSearch 返回值。
  @dataFormat
    作者选项使用 Git 姓名和邮箱区分同名作者；已选作者按 OR 匹配。
  @changeLog
    - 2026-11-07: Created. 提取原提交搜索界面，供两个历史视图共用。
    - 2026-11-10: Updated. 作者筛选支持多选与清除，输入框内汇总已选作者。
-->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, useId } from "vue";
import type { useCommitSearch } from "../composables/useCommitSearch";
import { authorMark, authorTone } from "../utils/author";

const props = defineProps<{
  /** 当前历史视图独立创建的搜索状态和交互方法。 */
  controller: ReturnType<typeof useCommitSearch>;
}>();

const searchRegion = ref<HTMLDivElement | null>(null);
const authorOptionsId = useId();
const {
  selectedAuthors, localSearch, searchInput, authorOptionsOpen, authorOptions, authorOptionsLoading,
  authorOptionsError, openAuthorOptions, closeAuthorOptions, loadAuthorOptions, onSearchFocusOut,
  onSearchInput, applySearch, clearSearch, dismissSearch, toggleAuthorFilter, clearAuthorFilters,
  isAuthorSelected,
} = props.controller;

// 搜索框高度固定，多选作者合并成一个标签展示，完整名单放在悬停提示里。
const selectedAuthorLabel = computed(() => {
  const firstAuthor = selectedAuthors.value[0];
  const firstName = firstAuthor?.name || firstAuthor?.email || "未知作者";
  const restCount = selectedAuthors.value.length - 1;
  return restCount > 0 ? `${firstName} +${restCount}` : firstName;
});
const selectedAuthorTitle = computed(() => {
  const names = selectedAuthors.value.map((author) => author.name || author.email || "未知作者");
  return names.length ? `清除作者筛选 · ${names.join("、")}` : "";
});

/**
 * 点击搜索区域以外时收起作者选项，保留关键词及已选作者。
 * @param event - 文档上的鼠标按下事件
 * @returns void
 */
function closeOptionsOnOutsideClick(event: MouseEvent): void {
  const target = event.target;
  const isOutsideSearch = target instanceof Node && !searchRegion.value?.contains(target);
  if (authorOptionsOpen.value && isOutsideSearch) {
    closeAuthorOptions();
  }
}

onMounted(() => document.addEventListener("mousedown", closeOptionsOnOutsideClick));
onUnmounted(() => document.removeEventListener("mousedown", closeOptionsOnOutsideClick));
</script>

<template>
  <div ref="searchRegion" class="search-wrap" @focusout="onSearchFocusOut" @keydown.esc="dismissSearch">
    <!-- 关键词输入和已选作者 -->
    <div class="search-field" @click.self="searchInput?.focus(); openAuthorOptions()">
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/></svg>
      <button
        v-if="selectedAuthors.length"
        class="search-author-filter"
        type="button"
        :title="selectedAuthorTitle"
        :aria-label="selectedAuthorTitle"
        @click="clearAuthorFilters"
      >
        <span>{{ selectedAuthorLabel }}</span>
        <span aria-hidden="true">×</span>
      </button>
      <input
        ref="searchInput"
        v-model="localSearch"
        class="search-input"
        type="search"
        placeholder="搜索提交、作者或哈希"
        aria-label="搜索提交"
        :aria-controls="authorOptionsOpen ? authorOptionsId : undefined"
        autocomplete="off"
        spellcheck="false"
        @focus="openAuthorOptions"
        @click="openAuthorOptions"
        @input="onSearchInput"
        @keydown.enter.prevent="applySearch"
      >
      <button v-if="localSearch" class="search-clear" type="button" aria-label="清除关键词" @click="clearSearch">×</button>
    </div>

    <!-- 作者快捷选项：可多选，点击同一项取消 -->
    <div v-if="authorOptionsOpen" :id="authorOptionsId" class="popover author-options" role="group" aria-label="最近半年提交作者">
      <div class="popover-head author-options-head">
        <span>最近半年提交作者</span>
        <button v-if="selectedAuthors.length" class="author-options-clear" type="button" @click="clearAuthorFilters">清除</button>
      </div>
      <div v-if="authorOptionsLoading" class="author-options-state" role="status">正在读取作者…</div>
      <div v-else-if="authorOptionsError" class="author-options-state" role="status">
        <span :title="authorOptionsError">作者读取失败</span>
        <button class="author-options-retry" type="button" @click="loadAuthorOptions">重试</button>
      </div>
      <div v-else-if="!authorOptions.length" class="author-options-state">此范围近半年没有提交作者</div>
      <template v-else>
        <button
          v-for="author in authorOptions"
          :key="author.sample_hash"
          class="menu-item author-option"
          :class="{ 'author-option-selected': isAuthorSelected(author) }"
          type="button"
          :aria-pressed="isAuthorSelected(author)"
          :title="author.email ? `${author.name} <${author.email}>` : author.name"
          @click="toggleAuthorFilter(author)"
        >
          <span class="avatar" :class="`tone-${authorTone(author.name)}`" aria-hidden="true">{{ authorMark(author.name) }}</span>
          <span class="author-option-identity">
            <span>{{ author.name || author.email || '未知作者' }}</span>
            <span v-if="author.name && author.email" class="author-option-email">{{ author.email }}</span>
          </span>
          <span v-if="isAuthorSelected(author)" aria-hidden="true">✓</span>
        </button>
      </template>
    </div>
  </div>
</template>
