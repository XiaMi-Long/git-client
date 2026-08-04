/**
 * 文件类型图标映射
 * 图标来源：vscode-icons（https://github.com/vscode-icons/vscode-icons，MIT License）
 * 本地内嵌于 src/assets/file-icons/，离线可用
 *
 * 匹配优先级：
 *   1. 特殊文件名精确匹配（package.json / README / Dockerfile 等）
 *   2. 文件名前缀模式（vite.config.* / .env* / Dockerfile.*）
 *   3. 扩展名映射
 *   4. fallback 通用图标
 */
import iconVue from "@/assets/file-icons/file_type_vue.svg";
import iconJs from "@/assets/file-icons/file_type_js.svg";
import iconReactJs from "@/assets/file-icons/file_type_reactjs.svg";
import iconTs from "@/assets/file-icons/file_type_typescript.svg";
import iconReactTs from "@/assets/file-icons/file_type_reactts.svg";
import iconHtml from "@/assets/file-icons/file_type_html.svg";
import iconCss from "@/assets/file-icons/file_type_css.svg";
import iconScss from "@/assets/file-icons/file_type_scss.svg";
import iconLess from "@/assets/file-icons/file_type_less.svg";
import iconSass from "@/assets/file-icons/file_type_sass.svg";
import iconJson from "@/assets/file-icons/file_type_json.svg";
import iconJson5 from "@/assets/file-icons/file_type_json5.svg";
import iconYaml from "@/assets/file-icons/file_type_yaml.svg";
import iconToml from "@/assets/file-icons/file_type_toml.svg";
import iconIni from "@/assets/file-icons/file_type_ini.svg";
import iconMarkdown from "@/assets/file-icons/file_type_markdown.svg";
import iconText from "@/assets/file-icons/file_type_text.svg";
import iconXml from "@/assets/file-icons/file_type_xml.svg";
import iconSvg from "@/assets/file-icons/file_type_svg.svg";
import iconImage from "@/assets/file-icons/file_type_image.svg";
import iconFont from "@/assets/file-icons/file_type_font.svg";
import iconRust from "@/assets/file-icons/file_type_rust.svg";
import iconC from "@/assets/file-icons/file_type_c.svg";
import iconCpp from "@/assets/file-icons/file_type_cpp.svg";
import iconPython from "@/assets/file-icons/file_type_python.svg";
import iconGo from "@/assets/file-icons/file_type_go.svg";
import iconJava from "@/assets/file-icons/file_type_java.svg";
import iconKotlin from "@/assets/file-icons/file_type_kotlin.svg";
import iconPhp from "@/assets/file-icons/file_type_php.svg";
import iconCsharp from "@/assets/file-icons/file_type_csharp.svg";
import iconShell from "@/assets/file-icons/file_type_shell.svg";
import iconBat from "@/assets/file-icons/file_type_bat.svg";
import iconPowerShell from "@/assets/file-icons/file_type_powershell.svg";
import iconSql from "@/assets/file-icons/file_type_sql.svg";
import iconDb from "@/assets/file-icons/file_type_db.svg";
import iconSqlite from "@/assets/file-icons/file_type_sqlite.svg";
import iconNpm from "@/assets/file-icons/file_type_npm.svg";
import iconYarn from "@/assets/file-icons/file_type_yarn.svg";
import iconGit from "@/assets/file-icons/file_type_git.svg";
import iconDocker from "@/assets/file-icons/file_type_docker.svg";
import iconTsconfig from "@/assets/file-icons/file_type_tsconfig.svg";
import iconVite from "@/assets/file-icons/file_type_vite.svg";
import iconConfig from "@/assets/file-icons/file_type_config.svg";
import iconEditorconfig from "@/assets/file-icons/file_type_editorconfig.svg";
import iconPrettier from "@/assets/file-icons/file_type_prettier.svg";
import iconEslint from "@/assets/file-icons/file_type_eslint.svg";
import iconLicense from "@/assets/file-icons/file_type_license.svg";
import iconBinary from "@/assets/file-icons/file_type_binary.svg";

/** 特殊文件名 → 图标（精确匹配，优先级最高） */
const FILENAME_MAP: Record<string, string> = {
  "package.json": iconNpm,
  "package-lock.json": iconNpm,
  "npm-shrinkwrap.json": iconNpm,
  ".npmrc": iconNpm,
  "yarn.lock": iconYarn,
  "README": iconMarkdown,
  "README.md": iconMarkdown,
  "readme.md": iconMarkdown,
  "LICENSE": iconLicense,
  "LICENSE.md": iconLicense,
  ".gitignore": iconGit,
  ".gitattributes": iconGit,
  ".gitmodules": iconGit,
  "Dockerfile": iconDocker,
  "tsconfig.json": iconTsconfig,
  "tsconfig.base.json": iconTsconfig,
  ".editorconfig": iconEditorconfig,
  ".prettierrc": iconPrettier,
  ".prettierrc.json": iconPrettier,
  ".eslintrc": iconEslint,
  ".eslintrc.json": iconEslint,
  ".eslintrc.js": iconEslint,
};

/** 扩展名 → 图标（小写，不含点） */
const EXT_MAP: Record<string, string> = {
  vue: iconVue,
  js: iconJs,
  mjs: iconJs,
  cjs: iconJs,
  jsx: iconReactJs,
  ts: iconTs,
  mts: iconTs,
  cts: iconTs,
  tsx: iconReactTs,
  html: iconHtml,
  htm: iconHtml,
  css: iconCss,
  scss: iconScss,
  less: iconLess,
  sass: iconSass,
  json: iconJson,
  json5: iconJson5,
  yaml: iconYaml,
  yml: iconYaml,
  toml: iconToml,
  ini: iconIni,
  md: iconMarkdown,
  markdown: iconMarkdown,
  txt: iconText,
  log: iconText,
  xml: iconXml,
  svg: iconSvg,
  png: iconImage,
  jpg: iconImage,
  jpeg: iconImage,
  gif: iconImage,
  webp: iconImage,
  ico: iconImage,
  bmp: iconImage,
  woff: iconFont,
  woff2: iconFont,
  ttf: iconFont,
  eot: iconFont,
  otf: iconFont,
  rs: iconRust,
  c: iconC,
  h: iconC,
  cpp: iconCpp,
  cc: iconCpp,
  cxx: iconCpp,
  hpp: iconCpp,
  hh: iconCpp,
  hxx: iconCpp,
  py: iconPython,
  pyw: iconPython,
  go: iconGo,
  java: iconJava,
  kt: iconKotlin,
  kts: iconKotlin,
  php: iconPhp,
  cs: iconCsharp,
  sh: iconShell,
  bash: iconShell,
  zsh: iconShell,
  bat: iconBat,
  cmd: iconBat,
  ps1: iconPowerShell,
  sql: iconSql,
  db: iconDb,
  sqlite: iconSqlite,
  sqlite3: iconSqlite,
  exe: iconBinary,
  dll: iconBinary,
  so: iconBinary,
  dylib: iconBinary,
  bin: iconBinary,
};

/** 文件名前缀模式 → 图标（次优先） */
const PREFIX_RULES: Array<{ prefix: string; icon: string }> = [
  { prefix: "vite.config", icon: iconVite },
  { prefix: ".env", icon: iconConfig },
  { prefix: "Dockerfile", icon: iconDocker },
  { prefix: "docker-compose", icon: iconDocker },
];

/** 兜底通用图标 */
export const FALLBACK_ICON = iconConfig;

/**
 * 根据文件路径解析类型图标
 * @param path 文件路径（支持相对/绝对，取 basename）
 */
export function resolveFileIcon(path: string): string {
  if (!path) return FALLBACK_ICON;
  const name = path.replace(/\\/g, "/").split("/").pop() ?? "";
  const lower = name.toLowerCase();

  // 1. 精确文件名
  const exact = FILENAME_MAP[lower];
  if (exact) return exact;

  // 2. 前缀模式（区分大小写的前缀已转小写处理，如 vite.config.*）
  for (const rule of PREFIX_RULES) {
    if (lower.startsWith(rule.prefix)) return rule.icon;
  }

  // 3. 扩展名（取最后一个点之后的字符）
  const dot = name.lastIndexOf(".");
  if (dot > 0 && dot < name.length - 1) {
    const ext = name.slice(dot + 1).toLowerCase();
    const hit = EXT_MAP[ext];
    if (hit) return hit;
  }

  // 4. 兜底
  return FALLBACK_ICON;
}
