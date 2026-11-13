import { judge as appNewJudge, prompt as appNewPrompt } from "./app-new.mjs";
// The same new app, asked for in a group chat with the Builder (D-46 step 2's open item): the
// Builder builds it there, for the person who asked.
export const group = true;
export const prompt = appNewPrompt;
export const judge = appNewJudge;
