import { ScriptTheme } from "./types";
import * as printUtils from "./textFormatting"
export const DEFAULT_THEME: ScriptTheme = {
  collapseLevel: 'none',
  colors: {
    primary: printUtils.blue,
    secondary: printUtils.white,
    accent: printUtils.green,
    dimmed: printUtils.darkGray,
    primaryBackground: printUtils.blueBackground,
    secondaryBackground: printUtils.grayBackground,
    accentBackground: printUtils.greenBackground,
    gradient: ['#00FFFF', '#FF00FF'],
    warning: printUtils.yellow,
    error: printUtils.red,
    info: printUtils.blue,
    debug: printUtils.darkGray,
    success: printUtils.green,
  },
  headerStyle: 'fancy',
  stageStyle: {
    formatString: '$stage: $message',
    color: printUtils.blue,
  },
  stepStyle: {
    formatString: '$step: $message',
  }
};
