// FLR Hub and the Cost Estimator: the FLR sign-in (Supabase). The same file sits next to both pages (the sync script
// copies it into estimator/). Both values are meant to be public: the key can do nothing on its own, because every
// database function refuses callers without a valid FLR sign-in (see the Estimator's docs/SUPABASE-SETUP.md).
// NEVER put the service_role key here.
window.FLR_CONFIG = {
  supabaseUrl: "https://jzcxucffzbuuhonepjtw.supabase.co",
  supabaseAnonKey: "sb_publishable_B38pIzkqOb3znR13Q1z_9g_oILllfX2",
};
// Fleet Management map tiles (satellite and streets) from Esri. A public "API key" meant for web pages: Esri only
// accepts it from hub.flr.co.uk, flr-group.github.io and flrmarketing.github.io (referrer restriction) and it can only load basemaps. Item "FLR Hub map" in
// the flrgroup.maps.arcgis.com ArcGIS Location Platform account; it expires about Oct 2027.
window.FLR_MAP_KEY = "AAPTayYbgpOHHDF40f2npJG05nQ..nanTMzxCV-eRIWc58CVrn9-Zm3PxtPO-7QtNbDB9ukNpyi__TFEJ2ceAw5Ve4BXNvpLio6W1iFpHv1y0M8TnR_FRk6hWbfvM5OTLPX5L0Tt5hfKHAvXnOTlG25XrEGaPKYQSUrrsFCFYHE9vJtYyOxY-Ubj62uhaR9kgna8SrhiYrmn_DbvLBSdtIf6JgP5NYpanjr-aid_Ra8M3ZbFj3I-XZzS4iMnbyPkah1Sj3J7LXDdX6mEkMjB6vNoC8qI.AT1_SYWlkZt1";
