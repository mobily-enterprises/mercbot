// A bot's commands signed in to GitHub (D-128). A command that names a repository (run_command's `github`) runs with a
// key of the copy's GitHub App, for that repository alone, which `gh` and `git` sign in with, once the
// person the bot works for let it use that repository on its card: for just this task, or always for this bot.

/** The card's answers: for this task, for good, or no. */
export const GITHUB_OPTIONS = Object.freeze(["Just this task", "Always for this bot", "No"]);
export const [GITHUB_TASK, GITHUB_ALWAYS, GITHUB_NO] = GITHUB_OPTIONS;
/** The card a bot asks to use a repository on. */
export const GITHUB_CARD = "github-repo";

/**
 * git's way to the key: a credential helper for https://github.com that answers with it, read from GH_TOKEN, so the
 * key is never written in a file or a repository's address.
 */
const CREDENTIAL_HELPER = "!f() { test \"$1\" = get && printf 'username=x-access-token\\npassword=%s\\n' \"$GH_TOKEN\"; }; f";

/**
 * What a command signed in to GitHub runs with: gh signed in with the key (GH_TOKEN) and asking nothing, git signed in
 * to https://github.com with it and never asking for a password, and the commits it makes are the bot's, through
 * Mercbot's GitHub App (`login`, its name on GitHub as `<slug>[bot]`).
 * @param {string} token the command's key
 * @param {{ name: string, login: string }} who the bot's name and the app's
 */
export function githubEnv(token, { name, login }) {
  const author = String(name || "Mercbot bot").replace(/[\r\n<>]/gu, " ").trim().slice(0, 80) || "Mercbot bot";
  const email = `${login || "mercbot"}@users.noreply.github.com`;
  return [
    `GH_TOKEN=${token}`,
    "GH_PROMPT_DISABLED=1",
    "GH_NO_UPDATE_NOTIFIER=1",
    "GH_HOST=github.com",
    "GIT_TERMINAL_PROMPT=0",
    "GIT_CONFIG_COUNT=1",
    "GIT_CONFIG_KEY_0=credential.https://github.com.helper",
    `GIT_CONFIG_VALUE_0=${CREDENTIAL_HELPER}`,
    `GIT_AUTHOR_NAME=${author}`,
    `GIT_AUTHOR_EMAIL=${email}`,
    `GIT_COMMITTER_NAME=${author}`,
    `GIT_COMMITTER_EMAIL=${email}`
  ];
}

/**
 * The card a bot asks to use a repository on: "Let <bot> use <owner/name>?", for the person it works for (the turn
 * adds `for`), with what the key may do there, and where the person can choose another of theirs.
 * @param {string} botName
 * @param {{ id: string, fullName: string, write: boolean, private: boolean }} repository as their GitHub sees it
 */
export function githubCard(botName, repository) {
  return {
    kind: "choice",
    role: "bot",
    body: {
      purpose: GITHUB_CARD,
      question: `Let ${botName} use ${repository.fullName}?`,
      subline: repository.write
        ? "It can read it, push branches and open pull requests there, as Mercbot's GitHub App, in its commands."
        : "You can only read it, so its commands can only read it too.",
      options: [...GITHUB_OPTIONS],
      multi: false,
      chosen: null,
      repository: {
        id: String(repository.id),
        fullName: repository.fullName,
        write: Boolean(repository.write),
        private: Boolean(repository.private)
      }
    }
  };
}

/**
 * The key for a command on `repository`, for the person whose turn it is: `{ secret }` to run with, `{ card }` to post
 * when they haven't let this bot use it yet (nothing is made), or `{ error }` for the bot. Only the turn's person's own
 * GitHub and their own yeses count (`call`): never another person's in the home or the room.
 * @param {object} turn
 * @param {import("@local/integrations/server/types").Integrations} turn.integrations
 * @param {import("./types.js").GithubRepoRepository} turn.githubRepos
 * @param {{ botId: string, chatBotId: string, botName: string }} turn.bot
 * @param {object} turn.call the turn's call options, for its person
 * @param {string} repository owner/name
 */
export async function githubCommandKey({ integrations, githubRepos, bot, call }, repository) {
  const github = integrations.connections.github;
  let reached;
  try {
    reached = await github.repository(call, String(repository).trim());
  } catch (error) {
    return { error: error.message };
  }
  if (!reached) {
    const install = github.installUrl();
    return {
      error:
        `${repository} isn't a repository Mercbot's GitHub App reaches with their GitHub: it doesn't exist, they can't see it, or Mercbot's GitHub App ` +
        `isn't installed on it.${install ? ` They choose its repositories at ${install}, then ask again.` : ""}`
    };
  }
  const found = reached.repository;
  if (!await githubRepos.allows({ botId: bot.botId, chatBotId: bot.chatBotId, repositoryId: found.id }, call)) {
    return { card: githubCard(bot.botName, found) };
  }
  try {
    const key = await github.commandKey(found);
    return {
      repository: found,
      secret: { env: githubEnv(key.token, { name: bot.botName, login: github.botLogin() }), hide: [key.token], ended: key.revoke }
    };
  } catch (error) {
    return { error: error.message };
  }
}
