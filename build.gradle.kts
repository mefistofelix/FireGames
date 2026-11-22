// The Android app is the root project: sources in src/android, web pages (src/web) packed as APK assets,
// every generated file under build/.
plugins {
    id("com.android.application") version "8.5.2"
    id("org.jetbrains.kotlin.android") version "1.9.24"
}

layout.buildDirectory.set(file("build/gradle"))

val buildNumber = System.getenv("BUILD_NUMBER") ?: "0"

android {
    namespace = "com.mefistofelix.firegames"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.mefistofelix.firegames"
        minSdk = 22 // Fire OS 5
        targetSdk = 34
        versionCode = buildNumber.toInt()
        versionName = "0.1.$buildNumber"
    }

    sourceSets {
        getByName("main") {
            manifest.srcFile("src/android/AndroidManifest.xml")
            java.srcDirs("src/android/java")
            res.srcDirs("src/android/res")
            assets.srcDirs("src/web")
        }
    }

    signingConfigs {
        getByName("debug") {
            // fixed debug key committed on purpose (the one of the other Fire TV apps) so builds update in place
            storeFile = file("src/android/debug.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
    }

    buildTypes {
        getByName("release") {
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    lint {
        checkReleaseBuilds = false
        abortOnError = false
    }
}
