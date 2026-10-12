// FLR Hub and the Cost Estimator: the FLR sign-in (Supabase). The same file sits next to both pages (the sync script
// copies it into estimator/). Both values are meant to be public: the key can do nothing on its own, because every
// database function refuses callers without a valid FLR sign-in (see the Estimator's docs/SUPABASE-SETUP.md).
// NEVER put the service_role key here.
window.FLR_CONFIG = {
  supabaseUrl: "https://jzcxucffzbuuhonepjtw.supabase.co",
  supabaseAnonKey: "sb_publishable_B38pIzkqOb3znR13Q1z_9g_oILllfX2",
};
// Fleet Management map tiles (satellite and streets) from Esri. A public "API key" meant for web pages: Esri only
// accepts it from flrmarketing.github.io (referrer restriction) and it can only load basemaps. Item "FLR Hub map" in
// the flrgroup.maps.arcgis.com ArcGIS Location Platform account; it expires about Oct 2027.
window.FLR_MAP_KEY = "AAPTaSG9PgFddAtl7qkUURbetfg..gpwmqIzib560RCSmRYVx4AvI__qxD1XjcIw3lbHMMr_oJu0ltMqJE2e4jbNTGpagVPuiLAxH5mKWm6jN2UMESNBVYFQgZ87WT3gGPVJ9uRWsRwrAvOr_8e7kjHtBtmT2LF9xBznJVU5TbMlWBh-j4eqDTr9Ld3k6-z2ZLmT7jqOZnqMuD0rKNmuU3KPIjn3aK8MCidm-gHYyN1wBgucCJzoj0KxIhRjn70Xp_2DCi9gWwGlokDOjK6ToiK54CyE.AT1_SYWlkZt1";
