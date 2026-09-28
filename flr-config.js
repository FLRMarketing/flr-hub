// FLR Hub and the Cost Estimator: the FLR sign-in (Supabase). The same file sits next to both pages (the sync script
// copies it into estimator/). Both values are meant to be public: the key can do nothing on its own, because every
// database function refuses callers without a valid FLR sign-in (see the Estimator's docs/SUPABASE-SETUP.md).
// NEVER put the service_role key here.
window.FLR_CONFIG = {
  supabaseUrl: "https://jzcxucffzbuuhonepjtw.supabase.co",
  supabaseAnonKey: "sb_publishable_B38pIzkqOb3znR13Q1z_9g_oILllfX2",
};
