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
window.FLR_MAP_KEY = "AAPTa85vHPKB2VDyBO_kY3zrnaw..h1m9adQNvEF6UStM4YDIgz6_OOqfKo1sbcox1YML7TZcfjbLp5-uHWOy79e2bg3b_QewNvYEi-qBfdxxx3UE1VIm7mQv5XUk_P42y9LmqMVboK6g9mksu7bXpZlFBQqzKVMr_l92UiplWQYKz9146fn1u5p3Ospkj8M60R4N0I0DJw_jMX0spo9ETM1KruHZf9WA4gyJC-b4S-eBXPKcrqhGLwBq2drvwepzv9Uvt9pTnUnL9RoX1kl53YREVQo.AT1_SYWlkZt1";
