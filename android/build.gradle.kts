// Force patched transitive versions on the buildscript/plugin classpath. These libraries are
// used by Android build tooling, not shipped in the APK, but GitHub Dependabot still reports them
// against this manifest. Versions are checked by scripts/audit-dependencies.mjs.
buildscript {
    configurations.classpath {
        resolutionStrategy {
            force(
                "io.netty:netty-common:4.1.137.Final",
                "io.netty:netty-buffer:4.1.137.Final",
                "io.netty:netty-resolver:4.1.137.Final",
                "io.netty:netty-transport:4.1.137.Final",
                "io.netty:netty-codec:4.1.137.Final",
                "io.netty:netty-handler:4.1.137.Final",
                "io.netty:netty-codec-http:4.1.137.Final",
                "io.netty:netty-codec-http2:4.1.137.Final",
                "io.netty:netty-handler-proxy:4.1.137.Final",
                "org.bouncycastle:bcpkix-jdk18on:1.85",
                "org.bouncycastle:bcprov-jdk18on:1.85",
                "com.google.guava:guava:33.7.2-jre",
                "org.jdom:jdom2:2.0.6.1",
                "org.bitbucket.b_c:jose4j:0.9.6",
                "org.apache.commons:commons-compress:1.26.0",
                "commons-io:commons-io:2.16.1",
                "com.google.protobuf:protobuf-java:3.25.5",
            )
        }
    }
}

plugins {
    id("com.android.application") version "8.13.2" apply false
    id("org.jetbrains.kotlin.android") version "2.4.21" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.4.21" apply false
    id("org.jetbrains.kotlin.jvm") version "2.4.21" apply false
}
