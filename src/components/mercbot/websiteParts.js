import { defineAsyncComponent } from "vue";

// A home's own website (D-84) on the screens: Settings → Website and the website row of a page's Share. It is one part
// a composition can leave out whole: this file replaced by `export default { settingsSections: [], pageShare: null }`
// takes both away, and the server's side is the @local/websites package alone.
export default {
  settingsSections: [
    { value: "website", title: "Website", icon: "$language", component: defineAsyncComponent(() => import("./MercbotSettingsWebsite.vue")) }
  ],
  pageShare: defineAsyncComponent(() => import("./MercbotPageWebsite.vue"))
};
