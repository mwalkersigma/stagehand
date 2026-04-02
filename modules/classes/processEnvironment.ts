import { execa } from "execa";
import { Environment } from "../types";

export class ProcessEnvironment implements Environment {
  public get(name: string): string | undefined {
    return process.env[name];
  }

  public async hasCommand(commandName: string): Promise<boolean> {
    try {
      await execa(process.platform === 'win32' ? 'where' : 'which', [commandName]);
      return true;
    } catch {
      return false;
    }
  }
}
