<script setup>
import { shellPreferences } from "@/components/mercbot/shellPreferences.js";

// Accent is kept per device (shellPreferences).
const accentOptions = [
  { title: "Bot colour", value: "bot" },
  { title: "Black", value: "black" }
];

const props = defineProps({
  runtime: {
    type: Object,
    required: true
  }
});

const preferences = props.runtime.preferences;
</script>

<template>
  <v-sheet rounded="lg" color="surface-container-low">
    <header class="pa-4 pb-0">
      <h2 class="text-h6 mb-0">Preferences</h2>
    </header>
    <div class="pa-4">
      <v-form @submit.prevent="preferences.submit" novalidate>
        <v-row>
          <v-col cols="12" md="4">
            <!-- readable-check: allow selection-field - data: the account settings runtime holds these as fixed lists, so nothing loads -->
            <v-select
              v-model="preferences.form.theme"
              label="Theme"
              :items="preferences.options.theme"
              item-title="title"
              item-value="value"
              variant="outlined"
              density="comfortable"
              :disabled="preferences.isSaving.value || preferences.isRefreshing.value"
              :error-messages="preferences.fieldErrors.theme"
            />
          </v-col>

          <v-col cols="12" md="4">
            <!-- readable-check: allow selection-field - data: the account settings runtime holds these as fixed lists, so nothing loads -->
            <v-select
              v-model="shellPreferences.accent"
              label="Accent colour"
              :items="accentOptions"
              item-title="title"
              item-value="value"
              variant="outlined"
              density="comfortable"
              hint="Saved on this device straight away"
              persistent-hint
            />
          </v-col>

          <v-col cols="12" md="4">
            <!-- readable-check: allow selection-field - data: the account settings runtime holds these as fixed lists, so nothing loads -->
            <v-select
              v-model="preferences.form.locale"
              label="Language / locale"
              :items="preferences.options.locale"
              item-title="title"
              item-value="value"
              variant="outlined"
              density="comfortable"
              :disabled="preferences.isSaving.value || preferences.isRefreshing.value"
              :error-messages="preferences.fieldErrors.locale"
            />
          </v-col>

          <v-col cols="12" md="4">
            <!-- readable-check: allow selection-field - data: the account settings runtime holds these as fixed lists, so nothing loads -->
            <v-select
              v-model="preferences.form.timeZone"
              label="Time zone"
              :items="preferences.options.timeZone"
              variant="outlined"
              density="comfortable"
              :disabled="preferences.isSaving.value || preferences.isRefreshing.value"
              :error-messages="preferences.fieldErrors.timeZone"
            />
          </v-col>

          <v-col cols="12" md="4">
            <!-- readable-check: allow selection-field - data: the account settings runtime holds these as fixed lists, so nothing loads -->
            <v-select
              v-model="preferences.form.dateFormat"
              label="Date format"
              :items="preferences.options.dateFormat"
              item-title="title"
              item-value="value"
              variant="outlined"
              density="comfortable"
              :disabled="preferences.isSaving.value || preferences.isRefreshing.value"
              :error-messages="preferences.fieldErrors.dateFormat"
            />
          </v-col>

          <v-col cols="12" md="4">
            <!-- readable-check: allow selection-field - data: the account settings runtime holds these as fixed lists, so nothing loads -->
            <v-select
              v-model="preferences.form.numberFormat"
              label="Number format"
              :items="preferences.options.numberFormat"
              item-title="title"
              item-value="value"
              variant="outlined"
              density="comfortable"
              :disabled="preferences.isSaving.value || preferences.isRefreshing.value"
              :error-messages="preferences.fieldErrors.numberFormat"
            />
          </v-col>

          <v-col cols="12" md="4">
            <!-- readable-check: allow selection-field - data: the account settings runtime holds these as fixed lists, so nothing loads -->
            <v-select
              v-model="preferences.form.currencyCode"
              label="Currency"
              :items="preferences.options.currency"
              variant="outlined"
              density="comfortable"
              :disabled="preferences.isSaving.value || preferences.isRefreshing.value"
              :error-messages="preferences.fieldErrors.currencyCode"
            />
          </v-col>

          <v-col cols="12" md="3">
            <!-- readable-check: allow selection-field - data: the account settings runtime holds these as fixed lists, so nothing loads -->
            <v-select
              v-model.number="preferences.form.avatarSize"
              label="Avatar size"
              :items="preferences.options.avatarSize"
              variant="outlined"
              density="comfortable"
              :disabled="preferences.isSaving.value || preferences.isRefreshing.value"
              :error-messages="preferences.fieldErrors.avatarSize"
            />
          </v-col>
        </v-row>

        <v-btn
          type="submit"
          color="primary"
          size="large"
          :disabled="preferences.isSaving.value || preferences.isRefreshing.value"
        >
          {{ preferences.isSaving.value ? "Saving preferences…" : "Save preferences" }}
        </v-btn>
      </v-form>
    </div>
  </v-sheet>
</template>
