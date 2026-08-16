<template>
  <div class="auth">
    <div class="auth__panel">
      <slot />
    </div>
    <p class="auth__footer">
      TS Database · Supportive &amp; low-income housing operations
    </p>
  </div>
</template>

<style scoped>
.auth {
  min-height: 100vh;
  background: var(--surface-app);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-6);
  padding: var(--space-6);
}

.auth__panel {
  width: 400px;
  max-width: 100%;
}

.auth__footer {
  font: var(--type-caption);
  color: var(--text-subtle);
}
</style>
