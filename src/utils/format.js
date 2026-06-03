/**
 * 格式化数字为可读字符串
 * @param {number} n
 * @returns {string} 如 "1.2M", "3.5K", "42"
 */
export function fmtNum(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/**
 * 计算字符串的显示宽度（考虑中文/CJK 字符占 2 个宽度）
 *
 * CJK 范围：
 *   U+2E80–U+9FFF  (CJK 部首、汉字)
 *   U+F900–U+FAFF  (CJK 兼容象形文字)
 *   U+FE30–U+FE4F  (CJK 兼容形式)
 *   U+20000–U+2FA1F (CJK 扩展)
 *   U+FF01–U+FF60  (全角 ASCII)
 *   U+FFE0–U+FFE6  (全角符号)
 *
 * Emoji 范围粗略覆盖：
 *   U+1F000–U+1FAFF
 *
 * @param {string} str
 * @returns {number} 显示宽度
 */
export function strWidth(str) {
  let width = 0;
  for (const char of str) {
    const cp = char.codePointAt(0);
    if (
      (cp >= 0x2E80 && cp <= 0x9FFF) ||
      (cp >= 0xF900 && cp <= 0xFAFF) ||
      (cp >= 0xFE30 && cp <= 0xFE4F) ||
      (cp >= 0xFF01 && cp <= 0xFF60) ||
      (cp >= 0xFFE0 && cp <= 0xFFE6) ||
      (cp >= 0x20000 && cp <= 0x2FA1F) ||
      (cp >= 0x1F000 && cp <= 0x1FAFF)
    ) {
      width += 2;
    } else {
      width += 1;
    }
  }
  return width;
}

/**
 * 基于显示宽度居中对齐文本
 * @param {string} text - 要居中的文本
 * @param {number} w - 目标总宽度
 * @returns {string} 左填充空格后的文本
 */
export function centerPad(text, w) {
  const textWidth = strWidth(text);
  const padL = Math.floor((w - textWidth) / 2);
  return ' '.repeat(Math.max(0, padL)) + text;
}

/**
 * 基于显示宽度右填充文本到指定宽度
 * @param {string} text - 文本
 * @param {number} w - 目标总宽度
 * @returns {string} 右填充空格后的文本
 */
export function padEnd(text, w) {
  const textWidth = strWidth(text);
  const padR = w - textWidth;
  return text + ' '.repeat(Math.max(0, padR));
}
