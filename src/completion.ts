import { ACTIONS } from "./format.ts";

export const SHELLS = ["zsh", "bash"] as const;
export type Shell = (typeof SHELLS)[number];
export const isShell = (value: string | undefined): value is Shell => SHELLS.includes(value as Shell);

/** Commands that take a script and `--out`. `check` takes a script only. */
const OUT_COMMANDS = ["try", "run", "record", "render"];

/** The shell script that completes showem's commands, `docs` actions, script files and `--out`. */
export function completion(shell: Shell, commands: readonly string[]): string {
  const all = [...commands, "-h", "--help", "-v", "--version"].join(" ");
  const actions = Object.keys(ACTIONS).join(" ");
  const shells = SHELLS.join(" ");
  if (shell === "zsh") {
    return `#compdef showem
_showem() {
  if (( CURRENT == 2 )); then
    compadd -- ${all}
    return
  fi
  case $words[2] in
    docs) (( CURRENT == 3 )) && compadd -- ${actions} ;;
    completion) (( CURRENT == 3 )) && compadd -- ${shells} ;;
    check) _files -g '*.(yaml|yml|json)' ;;
    ${OUT_COMMANDS.join("|")})
      if [[ $words[CURRENT-1] == --out ]]; then
        _files -g '*.mp4'
      else
        compadd -- --out
        _files -g '*.(yaml|yml|json)'
      fi ;;
  esac
}
if [[ $funcstack[1] == _showem ]]; then
  _showem "$@"
else
  compdef _showem showem
fi
`;
  }
  return `_showem() {
  local cur=\${COMP_WORDS[COMP_CWORD]} prev=\${COMP_WORDS[COMP_CWORD-1]}
  COMPREPLY=()
  if (( COMP_CWORD == 1 )); then
    COMPREPLY=($(compgen -W "${all}" -- "$cur"))
    return
  fi
  case \${COMP_WORDS[1]} in
    docs) (( COMP_CWORD == 2 )) && COMPREPLY=($(compgen -W "${actions}" -- "$cur")) ;;
    completion) (( COMP_CWORD == 2 )) && COMPREPLY=($(compgen -W "${shells}" -- "$cur")) ;;
    check) COMPREPLY=($(compgen -f -- "$cur")) ;;
    ${OUT_COMMANDS.join("|")})
      [[ $prev != --out ]] && COMPREPLY=($(compgen -W "--out" -- "$cur"))
      COMPREPLY+=($(compgen -f -- "$cur")) ;;
  esac
}
complete -o filenames -F _showem showem
`;
}
