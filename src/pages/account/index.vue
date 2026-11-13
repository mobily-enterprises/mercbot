<route lang="json">
{
  "meta": {
    "guard": {
      "policy": "authenticated"
    },
    "jskit": {
      "title": "Account settings",
      "parent": {
        "surface": "start",
        "path": "/"
      }
    }
  }
}
</route>

<script setup>
// The account settings page, the list of sections (each section is a page of its own, [section].vue), draws JSKIT's
// top app bar, which carries its title, the Up arrow back the way the person came (or to Mercbot's start, which opens
// their home) and the settings' Done action where Up can't go back. The settings pages are the account surface's
// pages with a bar: the app sign-in and link hand-offs beside them stay full-screen pages of their own, so the bar is
// in each settings page rather than in an account layout. The surface comes from the account pages root
// (config/public.js).
import ShellLayout from "@/components/ShellLayout.vue";
import AccountSettingsClientElement from "@jskit-ai/users-web/client/components/AccountSettingsClientElement";
</script>

<template>
  <ShellLayout title="" subtitle="">
    <AccountSettingsClientElement />
  </ShellLayout>
</template>
