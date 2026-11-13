# The tools' store (D-70), sourced by scripts/install-tools.sh and scripts/build-toolbox.sh once they
# have set TOOLS (Mercbot's .tools folder). Each tool is installed once per version into its own
# folder of the store, and .tools gets hard links to it: a tool already in the store at that version
# is reused, only a missing or changed one is installed, and .tools takes no disk of its own. The
# store is .tools/store in a checkout. `npm run deploy:prepare` puts it in the home's cache
# (MERCBOT_TOOLS_STORE, default $HOME/.cache/mercbot-tools), which on Vibe64 outlives releases, so
# only a host's first Publish installs everything. A running release keeps its own links, so
# replacing or removing a version in the store never touches it.
STORE="${MERCBOT_TOOLS_STORE:-$TOOLS/store}"

# Makes TO hard links to FROM's files (a copy where the store is on another file system), replacing
# what was there in one rename, so TO is never left half made.
tools_link() { # from to
  rm -rf "$2.new"
  mkdir -p "$(dirname "$2")"
  cp -al "$1" "$2.new" 2>/dev/null || { rm -rf "$2.new"; cp -a "$1" "$2.new"; }
  rm -rf "$2"
  mv "$2.new" "$2"
}

# Installs tool NAME at VERSION into the store with INSTALLER, which fills the folder it's given,
# unless the store has it already; removes the tool's other versions; and links its PATHS (relative
# to .tools) into .tools, removing any its install didn't make. An install counts only once its
# marker (.done), written last, is there: one cut short is installed again, never used.
tools_install() { # name version installer path...
  # Prefixed, so these locals never hide the variables an installer reads.
  local tool_name="$1" tool_installer="$3" tool_dir="$STORE/$1/$2" tool_other tool_path
  shift 3
  if [ ! -f "$tool_dir/.done" ]; then
    rm -rf "$tool_dir"
    mkdir -p "$tool_dir"
    "$tool_installer" "$tool_dir"
    touch "$tool_dir/.done"
  fi
  for tool_other in "$STORE/$tool_name"/*; do
    if [ "$tool_other" != "$tool_dir" ]; then rm -f "$tool_other/.done" && rm -rf "$tool_other"; fi
  done
  for tool_path in "$@"; do
    if [ -e "$tool_dir/$tool_path" ]; then
      tools_link "$tool_dir/$tool_path" "$TOOLS/$tool_path"
    else
      rm -rf "${TOOLS:?}/$tool_path"
    fi
  done
}
