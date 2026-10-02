/** Environment variables for a child process. Unlike `process.env`, values are never undefined. */
export type Environment = Record<string, string>;

/**
 * - `binary`: run directly (.exe / .com on Windows, any executable file on macOS).
 * - `batch`: a Windows .cmd / .bat file — usually an npm shim — run through cmd.exe.
 * - `powershell`: a Windows .ps1 script, run through Windows PowerShell.
 */
export type ExecutableKind = 'binary' | 'batch' | 'powershell';

export interface Executable {
  /** Absolute path of the file that was found. */
  path: string;
  kind: ExecutableKind;
}

/** What to spawn, ready for node-pty or child_process. */
export interface Command {
  file: string;
  args: string[];
  /**
   * Windows only: `args` are already quoted for cmd.exe and must not be quoted again.
   * node-pty: pass `args.join(' ')` as a string. child_process: set `windowsVerbatimArguments`.
   */
  verbatimArguments: boolean;
}

/** All OS-specific behaviour. Spec: V1 doc §6 (Cross-Platform Readiness). */
export interface Platform {
  readonly name: 'win32' | 'darwin';
  /** For UI labels such as "Reveal in Explorer". */
  readonly fileManagerName: string;

  /** Absolute path of the shell for plain terminals. */
  defaultShell(env: Environment): Promise<string>;
  /** Arguments for starting `shell` as an interactive terminal. */
  shellArgs(shell: string): string[];

  /**
   * Finds a CLI by name (PATH lookup) or by absolute path. Returns null if it isn't there.
   * Relative paths are refused: there is no meaningful working directory to resolve them from.
   */
  resolveExecutable(command: string, env: Environment): Promise<Executable | null>;
  /** Builds the spawn command for a resolved executable, quoting `args` where the OS needs it. */
  buildCommand(executable: Executable, args: string[], env: Environment): Command;

  /** Ends `pid` and every process it started. Resolves once done; a missing process is not an error. */
  killProcessTree(pid: number): Promise<void>;

  /**
   * The environment a fresh terminal would get: on Windows the current user + system variables
   * from the registry (so CLIs installed while the app runs are found); on macOS the login
   * shell's environment (apps started from Finder don't inherit the shell PATH).
   */
  loadUserEnvironment(): Promise<Environment>;

  /** Opens the system file manager with `path` selected. */
  revealInFileManager(path: string): void;
}
