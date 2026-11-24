package com.sikorokoro44.cloudopencode

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.sikorokoro44.cloudopencode.data.network.CloudApiClientImpl

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { CloudOpenCodeApp() }
    }
}

@Composable
private fun CloudOpenCodeApp() {
    val allowedHosts = remember {
        BuildConfig.CLOUD_HOST_ALLOWLIST.split(',')
            .map { it.trim() }
            .filter { it.isNotEmpty() }
            .toSet()
    }
    val backendClient = remember { CloudApiClientImpl(BuildConfig.CLOUD_BASE_URL, allowedHosts) }
    val backendReady = remember { backendClient.isSecureUrl(backendClient.baseUrl()) }
    MaterialTheme {
        Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            Column(
                modifier = Modifier.fillMaxSize().padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Text("Cloud OpenCode", fontSize = 32.sp, fontWeight = FontWeight.Bold)
                Text(
                    "AI-powered cloud app builder",
                    modifier = Modifier.padding(top = 8.dp),
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.secondary,
                )
                Text(
                    "Build Android apps with AI, GitHub and cloud APK builds.",
                    modifier = Modifier.padding(top = 16.dp),
                    style = MaterialTheme.typography.bodyMedium,
                )
                Text(
                    if (backendReady) "Cloud backend reachable: ${backendClient.baseUrl()}"
                    else "Cloud backend not configured securely",
                    modifier = Modifier.padding(top = 24.dp),
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
    }
}

