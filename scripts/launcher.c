// Main executable of TingType.app — a thin, compiled supervisor.
//
// Why a compiled launcher instead of running bun directly: macOS keys Microphone
// and Accessibility (TCC) consent to a process's *code-signing identity*. An
// ad-hoc signature is identified by the binary's hash, so compiling the whole TS
// daemon would change that hash — and silently revoke the user's grants — on every
// source edit. This launcher's content only depends on the baked bun/repo paths,
// so its hash (hence its TCC identity) is stable across daemon source changes:
// grant Mic + Accessibility to TingType once and it sticks across `deploy`s.
//
// It spawns bun on the TS source (preserving the no-build-step workflow) and stays
// alive as the parent, so the mic/keystroke children (ffmpeg, cliclick) inherit
// TingType's identity. SIGTERM/SIGINT are forwarded so launchd can stop it cleanly.
//
// BUN_PATH and REPO_DIR are baked in at compile time (see build_app_bundle).
#include <errno.h>
#include <signal.h>
#include <sys/wait.h>
#include <unistd.h>

static volatile pid_t child = 0;

static void forward(int sig) {
  if (child > 0) kill(child, sig);
}

int main(void) {
  signal(SIGTERM, forward);
  signal(SIGINT, forward);

  if (chdir(REPO_DIR) != 0) return 1;

  child = fork();
  if (child < 0) return 1;
  if (child == 0) {
    // PATH (for ffmpeg/cliclick) is supplied by the launchd plist and inherited.
    execl(BUN_PATH, "bun", "src/cli.ts", "run", (char *)0);
    _exit(127); // execl only returns on failure
  }

  int status = 0;
  while (waitpid(child, &status, 0) < 0 && errno == EINTR) {
    // retry across signal interruptions
  }
  return WIFEXITED(status) ? WEXITSTATUS(status) : 1;
}
