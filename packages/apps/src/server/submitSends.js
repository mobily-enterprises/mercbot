import { celSchema, evaluateFormula, formulaRecord, plainValue } from "../shared/formulas.js";

/**
 * What a create form sends once its button has added the record (`onSubmit`, D-137): each email or notice, its formulas
 * worked out with the record as it was saved (`made.values`, by field names) as `record`, through the app's sending
 * (its switches and daily limits; a visitor's emails at most 3 a day to one address). The record stays whatever happens:
 * a send that's refused or fails is said to a member (an effect) and only logged for a visitor. Answers the effects.
 * @param {{ sending: object }} parts the app's sending (appSending.js)
 * @param {object} actx the action's ctx (a visitor's or a member's)
 * @param {object} loaded the app as the runtime loaded it
 * @param {object} formNode the form
 * @param {{ table: string, id: string, values: object }} made the record its button added
 * @param {{ variables: object, scope: object, functions: object | null }} page what the action's formulas see
 */
export async function sendOnSubmit({ sending }, actx, loaded, formNode, made, { variables, scope, functions }) {
  const table = loaded.tableNamed(made.table);
  const record = formulaRecord(table, { ...made.values, id: made.id });
  const seen = { variables: { ...variables, record: celSchema(table) }, values: { ...scope, record } };
  const evaluate = (value) => (typeof value === "string" && value.startsWith("=")
    ? plainValue(evaluateFormula(seen.variables, value, seen.values, functions))
    : value);
  const effects = [];
  for (const send of formNode.onSubmit || []) {
    try {
      if (send.email) {
        const { to, subject, text } = send.email;
        const mail = { to: evaluate(to), subject: evaluate(subject), text: evaluate(text) };
        await sending.email(actx, loaded.app, mail, { visitor: Boolean(actx.visitor) });
      } else if (send.notify) {
        const to = send.notify.to === "owners" ? "owners" : evaluate(send.notify.to);
        await sending.notify(actx, loaded.app, { to, text: evaluate(send.notify.text) });
      }
    } catch (error) {
      if (!actx.visitor) effects.push({ notify: `Saved, but not sent: ${error.message}` });
      else console.warn(`A public form's send was refused or failed; the record was saved: ${error.message}`);
    }
  }
  return effects;
}
