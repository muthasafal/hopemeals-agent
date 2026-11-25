// The planner's own actions. Only names in the manifest's actions.agentTools become
// website_* tools.
import { App } from "./planner.js";

class SiteActions {
  static registerActions(actions) {
    actions.register({
      name: "get_plan",
      description: "Read the visitor's giving plan on this page: yearly total, months, amount per month, and the link to each partner charity's own page. Call it before answering about the plan, and again in each turn that needs it: the visitor can also change it on the page. Changes nothing.",
      effect: "read",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      execute: () => App.page.getState(),
    });
    actions.register({
      name: "set_plan",
      description: "Call it only when the visitor asks to change their plan. Sets the yearly total (rupees) and/or the number of months on the page. Returns the new plan, or ok false with the reason.",
      effect: "write",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          total: { type: "integer", minimum: 1, maximum: 100000000, description: "Yearly total in rupees, as the visitor said." },
          months: { type: "integer", minimum: 1, maximum: 12, description: "How many months to spread it over." },
        },
      },
      execute: (args) => App.page.setPlan(args),
    });
  }
}

export const registerActions = SiteActions.registerActions;
