import tailwindcss from '@tailwindcss/vite'

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2026-08-15',
  devtools: { enabled: true },

  // TS Database is an internal, auth-gated operations console whose data layer is
  // a live Convex subscription. Rendering it on the server would mean serving a
  // shell we immediately replace, so we ship it as a SPA and let Convex drive.
  ssr: false,

  modules: ['shadcn-nuxt'],

  typescript: {
    typeCheck: false,
    strict: true,
  },

  // vue-sonner's own stylesheet is what makes a toast `position: fixed`.
  // Without it the Toaster is a plain block in the layout's flex row.
  css: ['vue-sonner/style.css', '~/assets/css/tailwind.css'],

  vite: {
    plugins: [tailwindcss()],
  },

  shadcn: {
    // shadcn-vue primitives land in app/components/ui and register unprefixed
    // (`<Button>`, `<Card>`), matching shadcn's own docs.
    prefix: '',
    componentDir: './app/components/ui',
  },

  // `Ds*` covers the parts of the TS Database design system that shadcn has no
  // equivalent for; `Ts*` is product-specific composition on top of both.
  components: [
    { path: '~/components/ds', prefix: 'Ds', pathPrefix: false },
    { path: '~/components/app', prefix: 'Ts', pathPrefix: false },
  ],

  app: {
    // A short fade with a few pixels of travel — enough to signal that the
    // screen changed, not enough to make a shift's worth of navigation tiring.
    pageTransition: { name: 'page', mode: 'out-in' },

    head: {
      title: 'TS Database',
      htmlAttrs: { lang: 'en' },
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'description', content: 'Operations dashboard for supportive & low-income housing.' },
      ],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/logo-mark.svg' },
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
      ],
    },
  },

  runtimeConfig: {
    public: {
      convexUrl: process.env.NUXT_PUBLIC_CONVEX_URL || process.env.CONVEX_URL || '',
    },
  },

  /*
     The password the dev sign-in picker fills (see app/dev/AccountPicker.vue).

     Not `runtimeConfig.public`: every key there is serialized into the built
     app and served to the browser, so a production build that happened to have
     the variable set would publish it. A `define` split across $development and
     $production cannot do that — in a production build the literal is `""`
     before any bundling happens, whatever the environment says.
  */
  $development: {
    vite: {
      define: {
        __DEV_PASSWORD__: JSON.stringify(process.env.NUXT_PUBLIC_DEV_PASSWORD || ''),
      },
    },
  },

  $production: {
    vite: {
      define: { __DEV_PASSWORD__: '""' },
    },
  },
})
