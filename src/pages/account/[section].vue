<route lang="json">
{
  "meta": {
    "guard": {
      "policy": "authenticated"
    },
    "jskit": {
      "title": "Account settings",
      "parent": "/"
    }
  }
}
</route>

<script setup>
// One section of account settings (/account/preferences), JSKIT's users/account-settings pattern. Its parent is the
// section list, the account surface's "/", so on a phone or a medium window Up returns to the list; a wide window
// shows the list beside the section. It draws JSKIT's top app bar like the list's page (index.vue), since the account
// surface has no layout of its own.
import ShellLayout from "@/components/ShellLayout.vue";
import AccountSettingsClientElement from "@jskit-ai/users-web/client/components/AccountSettingsClientElement";
</script>

<template>
  <ShellLayout title="" subtitle="">
    <AccountSettingsClientElement />
  </ShellLayout>
</template>
