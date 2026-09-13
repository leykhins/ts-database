<script setup lang="ts">
/**
 * Sign-in shell — the inset two-panel composition.
 *
 * A pine story panel is set into the page with a margin around it, and the
 * form sits on the plain page beside it. The panel is the only place in the
 * product where colour covers a whole surface; it is doing the job a photo
 * would otherwise do, and it says what the building is for before asking who
 * you are.
 *
 * The panel is `aria-hidden`-adjacent in spirit but not in markup — the copy
 * in it is real and worth reading aloud. Only the drawing is hidden.
 */
</script>

<template>
  <main class="auth-page">
    <section class="auth-story">
      <TsBrandMark class="auth-brand" />

      <div class="auth-story-content">
        <h1>Behind every door,<br >a person.</h1>
        <p>
          One shared picture of your building.<br >
          So you can focus on the people in it.
        </p>

        <div class="auth-art">
          <TsBuildingIllustration />
          <div class="auth-care-note">
            <span class="auth-care-note__icon">
              <DsIcon name="heart-pulse" :size="22" />
            </span>
            <div>
              <strong>A good handover changes the day.</strong>
              <span>Your team's care, carried forward.</span>
            </div>
          </div>
        </div>
      </div>

      <footer class="auth-story-footer">
        <span>Built for the people who show up.</span>
        <span>Every building. Every shift.</span>
      </footer>
    </section>

    <section class="auth-form-side">
      <div class="auth-top-note">
        <DsIcon name="shield-check" :size="16" />
        <span>A secure space for your team</span>
      </div>

      <div class="auth-form-wrap">
        <slot />
      </div>

      <footer class="auth-footer">
        <span>TS Database</span>
        <span>Supportive &amp; low-income housing operations</span>
      </footer>
    </section>
  </main>
</template>

<style scoped>
.auth-page {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  min-height: 100dvh;
  padding: 20px;
  background: var(--surface-app);
}

/* ---- Story panel ---- */
.auth-story {
  display: flex;
  flex-direction: column;
  min-height: calc(100dvh - 40px);
  padding: 35px 48px;
  border-radius: var(--radius-2xl);
  background: var(--auth-story-bg);
  color: var(--auth-story-ink);

  /* Scoped to the panel so the drawing reads on pine rather than on paper. */
  --surface: var(--auth-story-bg);
  --illustration-fill: var(--auth-art-fill);
  --illustration-leaf: var(--auth-art-leaf);
  --illustration-sun: var(--auth-art-sun);
}

.auth-brand {
  align-self: flex-start;
  --brand-mark-bg: var(--auth-story-ink);
  --brand-mark-ink: var(--auth-story-bg);
}

.auth-story-content {
  margin: auto 0;
  padding: 40px 0 20px;
}

.auth-story :deep(h1) {
  max-width: 550px;
  font-family: var(--font-display);
  font-size: 49px;
  font-weight: 500;
  line-height: 1.18;
  letter-spacing: -2px;
  color: inherit;
}

.auth-story-content > p {
  margin-top: 22px;
  font-size: 14px;
  line-height: 1.9;
  color: var(--auth-story-muted);
}

.auth-art {
  position: relative;
  max-width: 440px;
  margin-top: 48px;
  padding-bottom: 26px;
  color: var(--auth-art-line);
}

/* The note overlaps the drawing's baseline: the building is the setting, the
   note is the point. */
.auth-care-note {
  position: relative;
  display: flex;
  gap: 13px;
  align-items: center;
  width: max-content;
  max-width: 100%;
  margin: -1px auto 0;
  padding: 16px 19px;
  border: 1px solid var(--auth-note-border);
  border-radius: var(--radius-lg);
  background: var(--auth-note-bg);
}

.auth-care-note__icon {
  display: flex;
  color: var(--auth-story-ink);
}

.auth-care-note strong {
  display: block;
  font-size: 11px;
  font-weight: 600;
  color: var(--auth-story-ink);
}

.auth-care-note span:not(.auth-care-note__icon) {
  display: block;
  margin-top: 4px;
  font-size: 10px;
  color: var(--auth-story-muted);
}

.auth-story-footer {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  font-size: 9px;
  color: var(--auth-story-muted);
}

/* ---- Form side ---- */
.auth-form-side {
  display: flex;
  flex-direction: column;
  padding: 26px 37px;
}

.auth-top-note {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  font-size: 10px;
  color: var(--text-muted);
}

.auth-form-wrap {
  width: 100%;
  max-width: 365px;
  margin: auto;
  padding: 55px 0 45px;
}

.auth-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 20px;
  font-size: 10px;
  color: var(--text-muted);
}

/* Below two columns the story panel becomes a masthead: kept, because it is
   the only thing on the page that says what this is, but cut down to the
   heading and the note. */
@media (max-width: 980px) {
  .auth-page {
    grid-template-columns: 1fr;
    gap: 16px;
  }

  .auth-story {
    min-height: 0;
    padding: 28px 30px;
  }

  .auth-story :deep(h1) {
    font-size: 34px;
    letter-spacing: -1.2px;
  }

  .auth-story-content {
    padding: 24px 0 4px;
  }

  .auth-art,
  .auth-story-footer {
    display: none;
  }

  .auth-form-side {
    padding: 0 10px;
  }

  .auth-form-wrap {
    padding: 20px 0 30px;
  }
}
</style>
