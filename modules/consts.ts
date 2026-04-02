import { ScriptTheme } from "./types";
import * as printutils from "./textFormatting"
export const DEFAULT_THEME: ScriptTheme = {
  collapseLevel: 'none',
  colors: {
    primary: printutils.blue,
    secondary: printutils.white,
    accent: printutils.green,
    dimmed: printutils.darkGray,
    primaryBackground: printutils.blueBackground,
    secondaryBackground: printutils.grayBackground,
    accentBackground: printutils.greenBackground,
    gradient: ['#00FFFF', '#FF00FF'],
    warning: printutils.yellow,
    error: printutils.red,
    info: printutils.blue,
    debug: printutils.darkGray,
    success: printutils.green,
  },
  headerStyle: 'fancy',
  stageStyle: {
    formatString: '$stage: $message',
    color: printutils.blue,
  },
  stepStyle: {
    formatString: '$step: $message',
  }
};
