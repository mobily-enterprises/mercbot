import { chatModel as providerModel } from "@jskit-ai/agent/server";
import { currentWork } from "@local/account/meter";
import { botsAiOff, modelSettings } from "@local/account/model";

/**
 * The chat model every bot call uses (D-45, D-48, D-59, D-72): DeepSeek's Flash model, metered to the person and bot
 * the work is for, on the kind of AI the work in progress runs on (providers/index.js, WORK). The bots feature makes
 * the one it passes around, so nothing that calls it needs to know.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env
 */
export function createChatModel(env) {
  const models = {
    chat: providerModel(modelSettings(env, "chat")),
    build: providerModel(modelSettings(env, "build")),
    background: providerModel(modelSettings(env, "background"))
  };
  const doGenerate = (options) => models[currentWork()].doGenerate(options);
  const doStream = (options) => models[currentWork()].doStream(options);
  return Object.freeze({
    specificationVersion: models.chat.specificationVersion,
    provider: models.chat.provider,
    modelId: models.chat.modelId,
    supportedUrls: models.chat.supportedUrls,
    doGenerate,
    doStream
  });
}

/**
 * The meter bots run on: the account's, except on a copy whose AI isn't set up (botsAiOff), where every home's new bot
 * work is paused with the notice saying so, through the meter's pausedMessage (D-73). Bots then start nothing new and say why,
 * to each message and once for work no one waits on, and a new bot's welcome uses its standard words.
 * @param {import("@local/account/server/types").Meter} meter
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} env
 * @returns {import("@local/account/server/types").Meter}
 */
export function botsMeter(meter, env) {
  const off = botsAiOff(env);
  return off ? Object.freeze({ ...meter, pausedMessage: async () => off }) : meter;
}
