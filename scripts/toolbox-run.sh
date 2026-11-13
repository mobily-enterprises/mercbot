# The toolbox's install run in gVisor (D-47), sourced by scripts/build-toolbox.sh.
#
# runsc's output goes to files, shown once the sandbox has ended, never to the build's own output nor
# through a pipe: gVisor shuts down an inherited socket when its sandbox ends, and Publish's output is
# one (the build's next line died of SIGPIPE, status 141), and a pipe's reader would wait for any
# sandbox process still holding it. Whatever of the sandbox outlived `runsc run` is stopped. Each
# failure says what it is: the install failing inside the sandbox (its first step marks
# /install.started), shown with the end of its errors, the host not letting Mercbot start the sandbox
# at all, or the build's own output closing while the install's output is shown, which stops the build
# with that write's status (141 for SIGPIPE).

# Runs ROOTFS/install.sh in the sandbox BUNDLE's config.json describes, with runsc's state in STATE.
toolbox_run() { # runsc state bundle rootfs
  local runsc="$1" state="$2" bundle="$3" rootfs="$4" id="toolbox-$$" status=0
  rm -f "$rootfs/install.started"
  "$runsc" --rootless --network=none --ignore-cgroups --overlay2=none --root="$state" run --bundle "$bundle" "$id" \
    >"$bundle/install.log" 2>"$bundle/runsc.log" </dev/null || status=$?
  "$runsc" --root="$state" delete -force "$id" >/dev/null 2>&1 || true
  cat "$bundle/install.log"
  if [ "$status" -ne 0 ]; then
    if [ -e "$rootfs/install.started" ]; then
      tail -20 "$bundle/runsc.log" >&2
      printf '%s\n' "The toolbox's install failed inside its sandbox (status $status); its output is above." >&2
    else
      printf '%s\n' "This host doesn't let Mercbot create its own sandboxes, which its bots' computers need. See README → Hosting requirements." >&2
      tail -20 "$bundle/runsc.log" >&2
    fi
    return 1
  fi
  rm -f "$bundle/install.log" "$bundle/runsc.log" "$rootfs/install.started"
}
