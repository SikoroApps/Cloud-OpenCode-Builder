package com.sikorokoro44.cloudopencode.ui

import com.sikorokoro44.cloudopencode.data.network.BuildArtifact
import com.sikorokoro44.cloudopencode.data.network.ProjectBuild
import java.util.Locale

/**
 * Pure helpers for APK delivery so the build/artifact rules can be unit tested on the JVM.
 */
object ApkDelivery {
    fun buildReady(build: ProjectBuild?): Boolean =
        build?.status == "completed" && build.conclusion == "success"

    fun deliveryStatusMessage(build: ProjectBuild?): String = when {
        build == null -> "Select a successful build to load APK artifacts"
        build.status != "completed" -> "Build ${build.id} is ${build.status}; APK delivery is available after it completes"
        build.conclusion != "success" -> "Build ${build.id} finished with ${build.conclusion ?: "unknown"}; no APK is available"
        else -> "Build ${build.id} succeeded; load artifacts to deliver the APK"
    }

    fun preferredArtifact(artifacts: List<BuildArtifact>): BuildArtifact? =
        artifacts.firstOrNull { it.name.contains("apk", ignoreCase = true) }
            ?: artifacts.firstOrNull { it.name.contains("debug", ignoreCase = true) }
            ?: artifacts.firstOrNull()

    fun formatFileSize(bytes: Long): String = when {
        bytes >= 1024L * 1024L -> String.format(Locale.US, "%.2f MiB", bytes / (1024.0 * 1024.0))
        bytes >= 1024L -> String.format(Locale.US, "%.2f KiB", bytes / 1024.0)
        else -> "$bytes B"
    }
}
