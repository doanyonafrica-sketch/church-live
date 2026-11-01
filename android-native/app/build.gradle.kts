plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }
android {
    namespace = "africa.doanyon.livecam"
    compileSdk = 34
    defaultConfig { applicationId = "africa.doanyon.livecam"; minSdk = 24; targetSdk = 34; versionCode = 1; versionName = "1.0" }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
}
dependencies {
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("io.getstream:stream-webrtc-android:1.1.1")
}
