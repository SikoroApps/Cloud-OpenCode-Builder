/**
 * Deterministic Android Compose starter project generator.
 *
 * The generated files are a complete, buildable project: Gradle Kotlin DSL,
 * AGP + Kotlin Compose plugin, a Material 3 Compose activity, launcher icons
 * and a cloud build workflow. No secrets or machine-specific paths are emitted.
 */

export interface ScaffoldInput {
  appName: string;
  packageName?: string;
}

export interface ScaffoldResult {
  appName: string;
  packageName: string;
  files: Record<string, string>;
}

const GRADLE_VERSION = "8.7";
const AGP_VERSION = "8.7.3";
const KOTLIN_VERSION = "2.0.21";
const COMPILE_SDK = 35;

export function normalizeAppName(raw: string): string {
  const name = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (!name || name.length > 60) throw new Error("invalid_app_name");
  // XML string content must not contain markup or control characters.
  if (/[<>&\x00-\x1f]/.test(name)) throw new Error("invalid_app_name");
  return name;
}

export function normalizePackageName(raw: string, appName: string): string {
  const requested = String(raw ?? "").trim();
  if (/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(requested) && requested.length <= 180) {
    return requested;
  }
  const source = requested || appName;
  const segments = source
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, ".")
    .split(".")
    .filter(Boolean)
    .map((segment) => (/^[a-z]/.test(segment) ? segment : `app${segment}`));
  const unique = [...new Set(segments)];
  const packageName = ["com", "example", ...unique].join(".");
  if (packageName.length > 180 || packageName.split(".").some((part) => part.length > 60)) {
    throw new Error("invalid_package_name");
  }
  return packageName;
}

export function scaffoldBuildWorkflow(): string {
  return [
    "name: Android build",
    "on:",
    "  workflow_dispatch:",
    "permissions:",
    "  contents: read",
    "jobs:",
    "  build:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "      - uses: actions/setup-java@v4",
    "        with:",
    "          distribution: temurin",
    "          java-version: '17'",
    "      - uses: android-actions/setup-android@v3",
    "      - name: Install Gradle",
    "        run: |",
    "          set -euo pipefail",
    `          curl -fsSL -o /tmp/gradle.zip https://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip`,
    "          unzip -q /tmp/gradle.zip -d /opt",
    `          echo "/opt/gradle-${GRADLE_VERSION}/bin" >> "$GITHUB_PATH"`,
    "      - name: Assemble debug APK",
    "        run: gradle assembleDebug --no-daemon",
    "      - name: Verify APK signature and checksum",
    "        run: |",
    "          set -euo pipefail",
    "          APK=$(find app/build/outputs/apk/debug -name '*.apk' | head -n 1)",
    "          test -n \"$APK\"",
    "          APKSIGNER=$(find \"$ANDROID_HOME/build-tools\" -type f -name apksigner | sort -V | tail -n 1)",
    "          {",
    "            echo \"=== apksigner verify --verbose ===\"",
    "            \"$APKSIGNER\" verify --verbose \"$APK\"",
    "            echo \"=== sha256sum ===\"",
    "            sha256sum \"$APK\"",
    "          } > app-debug-apk.sha256 2>&1",
    "          cat app-debug-apk.sha256",
    "      - name: Upload APK",
    "        uses: actions/upload-artifact@v4",
    "        with:",
    "          name: app-debug-apk",
    "          path: app/build/outputs/apk/debug/*.apk",
    "      - name: Upload APK checksum evidence",
    "        uses: actions/upload-artifact@v4",
    "        with:",
    "          name: app-debug-apk-evidence",
    "          path: app-debug-apk.sha256",
    "",
  ].join("\n");
}

export function launcherIconFiles(): Record<string, string> {
  return {
    "app/src/main/res/values/ic_launcher_background.xml": [
      "<?xml version=\"1.0\" encoding=\"utf-8\"?>",
      "<resources>",
      "    <color name=\"ic_launcher_background\">#FF1565C0</color>",
      "</resources>",
      "",
    ].join("\n"),
    "app/src/main/res/drawable/ic_launcher_foreground.xml": [
      "<?xml version=\"1.0\" encoding=\"utf-8\"?>",
      "<vector xmlns:android=\"http://schemas.android.com/apk/res/android\"",
      "    android:width=\"108dp\"",
      "    android:height=\"108dp\"",
      "    android:viewportWidth=\"108\"",
      "    android:viewportHeight=\"108\">",
      "    <path",
      "        android:fillColor=\"#FFFFFFFF\"",
      "        android:pathData=\"M54,30 L74,42 L74,66 L54,78 L34,66 L34,42 Z\" />",
      "</vector>",
      "",
    ].join("\n"),
    "app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml": [
      "<?xml version=\"1.0\" encoding=\"utf-8\"?>",
      "<adaptive-icon xmlns:android=\"http://schemas.android.com/apk/res/android\">",
      "    <background android:drawable=\"@color/ic_launcher_background\" />",
      "    <foreground android:drawable=\"@drawable/ic_launcher_foreground\" />",
      "</adaptive-icon>",
      "",
    ].join("\n"),
  };
}

export function androidScaffold(input: ScaffoldInput): ScaffoldResult {
  const appName = normalizeAppName(input.appName || "Cloud App");
  const packageName = normalizePackageName(input.packageName || "", appName);
  const activityPackage = packageName;
  const themeName = "Theme.CloudApp";
  const activityPath = `app/src/main/java/${activityPackage.replace(/\./g, "/")}/MainActivity.kt`;

  const files: Record<string, string> = {
    "settings.gradle.kts": [
      "pluginManagement {",
      "    repositories {",
      "        google()",
      "        mavenCentral()",
      "        gradlePluginPortal()",
      "    }",
      "}",
      "dependencyResolutionManagement {",
      "    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)",
      "    repositories {",
      "        google()",
      "        mavenCentral()",
      "    }",
      "}",
      `rootProject.name = "${appName.replace(/"/g, "")}"`,
      'include(":app")',
      "",
    ].join("\n"),
    "build.gradle.kts": [
      "plugins {",
      `    id("com.android.application") version "${AGP_VERSION}" apply false`,
      `    id("org.jetbrains.kotlin.android") version "${KOTLIN_VERSION}" apply false`,
      `    id("org.jetbrains.kotlin.plugin.compose") version "${KOTLIN_VERSION}" apply false`,
      "}",
      "",
    ].join("\n"),
    "gradle/wrapper/gradle-wrapper.properties": [
      "distributionBase=GRADLE_USER_HOME",
      "distributionPath=wrapper/dists",
      `distributionUrl=https\\://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip`,
      "networkTimeout=10000",
      "validateDistributionUrl=true",
      "zipStoreBase=GRADLE_USER_HOME",
      "zipStorePath=wrapper/dists",
      "",
    ].join("\n"),
    "app/build.gradle.kts": [
      "plugins {",
      '    id("com.android.application")',
      '    id("org.jetbrains.kotlin.android")',
      '    id("org.jetbrains.kotlin.plugin.compose")',
      "}",
      "",
      "android {",
      `    namespace = "${packageName}"`,
      `    compileSdk = ${COMPILE_SDK}`,
      "",
      "    defaultConfig {",
      `        applicationId = "${packageName}"`,
      "        minSdk = 26",
      `        targetSdk = ${COMPILE_SDK}`,
      "        versionCode = 1",
      '        versionName = "1.0"',
      "    }",
      "",
      "    buildTypes {",
      '        getByName("release") {',
      "            isMinifyEnabled = false",
      "        }",
      "    }",
      "    compileOptions {",
      "        sourceCompatibility = JavaVersion.VERSION_17",
      "        targetCompatibility = JavaVersion.VERSION_17",
      "    }",
      "    kotlinOptions {",
      '        jvmTarget = "17"',
      "    }",
      "    buildFeatures {",
      "        compose = true",
      "    }",
      "}",
      "",
      "dependencies {",
      '    implementation("androidx.core:core-ktx:1.13.1")',
      '    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.6")',
      '    implementation("androidx.activity:activity-compose:1.9.2")',
      '    implementation(platform("androidx.compose:compose-bom:2024.10.00"))',
      '    implementation("androidx.compose.ui:ui")',
      '    implementation("androidx.compose.ui:ui-tooling-preview")',
      '    implementation("androidx.compose.material3:material3")',
      '    debugImplementation("androidx.compose.ui:ui-tooling")',
      "}",
      "",
    ].join("\n"),
    "app/src/main/AndroidManifest.xml": [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<manifest xmlns:android="http://schemas.android.com/apk/res/android">',
      "    <application",
      '        android:allowBackup="true"',
      '        android:icon="@mipmap/ic_launcher"',
      '        android:label="@string/app_name"',
      `        android:theme="@style/${themeName}"`,
      '        android:supportsRtl="true">',
      "        <activity",
      '            android:name=".MainActivity"',
      '            android:exported="true"',
      '            android:label="@string/app_name"',
      `            android:theme="@style/${themeName}">`,
      "            <intent-filter>",
      '                <action android:name="android.intent.action.MAIN" />',
      '                <category android:name="android.intent.category.LAUNCHER" />',
      "            </intent-filter>",
      "        </activity>",
      "    </application>",
      "</manifest>",
      "",
    ].join("\n"),
    [activityPath]: [
      `package ${activityPackage}`,
      "",
      "import android.os.Bundle",
      "import androidx.activity.ComponentActivity",
      "import androidx.activity.compose.setContent",
      "import androidx.compose.foundation.layout.Box",
      "import androidx.compose.foundation.layout.fillMaxSize",
      "import androidx.compose.material3.MaterialTheme",
      "import androidx.compose.material3.Surface",
      "import androidx.compose.material3.Text",
      "import androidx.compose.ui.Alignment",
      "import androidx.compose.ui.Modifier",
      "",
      "class MainActivity : ComponentActivity() {",
      "    override fun onCreate(savedInstanceState: Bundle?) {",
      "        super.onCreate(savedInstanceState)",
      "        setContent {",
      "            MaterialTheme {",
      "                Surface(",
      "                    modifier = Modifier.fillMaxSize(),",
      "                    color = MaterialTheme.colorScheme.background,",
      "                ) {",
      "                    Box(",
      "                        modifier = Modifier.fillMaxSize(),",
      "                        contentAlignment = Alignment.Center,",
      "                    ) {",
      `                        Text(text = "${appName.replace(/"/g, '\\"')}")`,
      "                    }",
      "                }",
      "            }",
      "        }",
      "    }",
      "}",
      "",
    ].join("\n"),
    "app/src/main/res/values/strings.xml": [
      '<?xml version="1.0" encoding="utf-8"?>',
      "<resources>",
      `    <string name="app_name">${appName}</string>`,
      "</resources>",
      "",
    ].join("\n"),
    "app/src/main/res/values/themes.xml": [
      '<?xml version="1.0" encoding="utf-8"?>',
      "<resources>",
      `    <style name="${themeName}" parent="android:Theme.Material.Light.NoActionBar" />`,
      "</resources>",
      "",
    ].join("\n"),
    ".gitignore": [
      "*.iml",
      ".gradle",
      "/local.properties",
      "/.idea",
      ".DS_Store",
      "/build",
      "/app/build",
      "/captures",
      ".externalNativeBuild",
      ".cxx",
      "*.jks",
      "*.keystore",
      "",
    ].join("\n"),
    ".github/workflows/android-build.yml": scaffoldBuildWorkflow(),
    ...launcherIconFiles(),
  };
  return { appName, packageName, files };
}
