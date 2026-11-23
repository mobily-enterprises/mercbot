<script setup>
// Three dots that rise in turn: someone is typing (useChatTyping.js). Still for people who ask for less motion.
</script>

<template>
  <span class="mb-typing-dots" aria-hidden="true"><span /><span /><span /></span>
</template>

<style scoped>
.mb-typing-dots {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 3px;
  height: 8px;
}

.mb-typing-dots span {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: currentcolor;
  opacity: 0.4;
  animation: mb-typing-dot 1.2s ease-in-out infinite;
}

.mb-typing-dots span:nth-child(2) {
  animation-delay: 0.15s;
}

.mb-typing-dots span:nth-child(3) {
  animation-delay: 0.3s;
}

@keyframes mb-typing-dot {
  0%,
  60%,
  100% {
    transform: translateY(0);
    opacity: 0.4;
  }

  30% {
    transform: translateY(-3px);
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .mb-typing-dots span {
    animation: none;
    opacity: 0.7;
  }
}
</style>
