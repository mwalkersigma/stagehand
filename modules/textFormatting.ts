export function formatText(text: string, before: number, after: number): string {
  const isTty = typeof process !== 'undefined' && process.stdout?.isTTY === true
  return isTty
    ? "\u001b[" + before + "m" + text + "\u001b[" + after + "m"
    : text;
}

export function textBackground(text: string, backgroundColorCode: number): string {
  const isTty = typeof process !== 'undefined' && process.stdout?.isTTY === true
  const resetCode = 49; // Reset background color
  return isTty
    ? `\u001b[${backgroundColorCode}m${text}\u001b[${resetCode}m`
    : text;
}

export function Bold(text: string): string {
  return formatText(text, 1, 22);
}

export function green(text: string): string {
  return formatText(text, 32, 39);
}

export function greenBackground(text: string): string {
  return textBackground(text, 42);
}

export function red(text: string): string {
  return formatText(text, 31, 39);
}

export function redBackground(text: string): string {
  return textBackground(text, 41);
}

export function blue(text: string): string {
  return formatText(text, 34, 39);
}

export function blueBackground(text: string): string {
  return textBackground(text, 44);
}

export function yellow(text: string): string {
  return formatText(text, 33, 39);
}

export function yellowBackground(text: string): string {
  return textBackground(text, 43);
}

export function lightGray(text: string): string {
  return formatText(text, 37, 39);
}

export function grayBackground(text: string): string {
  return textBackground(text, 47);
}

export function darkGray(text: string): string {
  return formatText(text, 90, 39);
}

export function Italic(text: string): string {
  return formatText(text, 3, 23);
}

export function blueEdges(text: string): string {
  return `${blue("|")} ${text} ${blue("|")}`
}
export function white(text: string): string {
  return formatText(text, 10, 39);
}

export function GradientText(text: string, startColor: string, endColor: string): string {
  const start = parseInt(startColor.replace('#', ''), 16);
  const end = parseInt(endColor.replace('#', ''), 16);
  const startR = (start >> 16) & 0xFF;
  const startG = (start >> 8) & 0xFF;
  const startB = start & 0xFF;
  const endR = (end >> 16) & 0xFF;
  const endG = (end >> 8) & 0xFF;
  const endB = end & 0xFF;
  const steps = text.length;
  let gradientText = '';
  for (let i = 0; i < steps; i++) {
    const ratio = i / (steps - 1);
    const r = Math.round(startR + ratio * (endR - startR));
    const g = Math.round(startG + ratio * (endG - startG));
    const b = Math.round(startB + ratio * (endB - startB));
    gradientText += `\u001b[38;2;${r};${g};${b}m${text[i]}`;
  }
  return gradientText + "\u001b[0m"; // Reset color at the end
}
