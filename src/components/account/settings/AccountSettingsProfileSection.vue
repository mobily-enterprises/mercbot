<script setup>
const props = defineProps({
  runtime: {
    type: Object,
    required: true
  }
});

const profile = props.runtime.profile;
</script>

<template>
  <v-sheet rounded="lg" color="surface-container-low">
    <header class="pa-4 pb-0">
      <h2 class="text-h6 mb-0">Profile</h2>
    </header>
    <div class="pa-4">
      <v-form @submit.prevent="profile.submit" novalidate>
        <v-row class="mb-2">
          <v-col cols="12" md="4" class="d-flex flex-column align-center justify-center">
            <v-avatar :size="profile.avatar.size" color="surface-variant" rounded="circle" class="mb-3">
              <v-img v-if="profile.avatar.effectiveUrl" :src="profile.avatar.effectiveUrl" cover />
              <span v-else class="text-h6">{{ profile.initials.value }}</span>
            </v-avatar>
            <div class="text-caption text-medium-emphasis">Preview size: {{ profile.avatar.size }} px</div>
          </v-col>

          <v-col cols="12" md="8">
            <div class="d-flex flex-wrap ga-2 mb-2">
              <v-btn
                variant="tonal"
                color="secondary"
                size="large"
                :disabled="profile.isSaving.value || profile.isDeletingAvatar.value || profile.isRefreshing.value"
                @click="profile.openAvatarEditor"
              >
                Replace avatar
              </v-btn>
              <v-btn
                v-if="profile.avatar.hasUploadedAvatar"
                variant="text"
                color="error"
                size="large"
                :disabled="profile.isSaving.value || profile.isDeletingAvatar.value || profile.isRefreshing.value"
                @click="profile.removeAvatar"
              >
                {{ profile.isDeletingAvatar.value ? "Removing avatar…" : "Remove avatar" }}
              </v-btn>
            </div>

            <div v-if="profile.selectedAvatarFileName.value" class="text-caption text-medium-emphasis mb-2">
              Selected file: {{ profile.selectedAvatarFileName.value }}
            </div>
          </v-col>
        </v-row>

        <v-row>
          <v-col cols="12" md="6">
            <v-text-field
              v-model="profile.form.displayName"
              label="Display name"
              variant="outlined"
              density="comfortable"
              autocomplete="nickname"
              :readonly="profile.isSaving.value || profile.isRefreshing.value"
              :error-messages="profile.fieldErrors.displayName"
            />
          </v-col>

          <v-col cols="12" md="6">
            <v-text-field
              v-model="profile.form.email"
              label="Email"
              variant="outlined"
              density="comfortable"
              readonly
              hint="Managed by your sign-in account"
              persistent-hint
            />
          </v-col>
        </v-row>

        <v-btn
          type="submit"
          color="primary"
          size="large"
          :disabled="profile.isSaving.value || profile.isDeletingAvatar.value || profile.isRefreshing.value"
        >
          {{ profile.isSaving.value ? "Saving profile…" : "Save profile" }}
        </v-btn>
      </v-form>
    </div>
  </v-sheet>
</template>
