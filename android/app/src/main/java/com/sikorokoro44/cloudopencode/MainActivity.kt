package com.sikorokoro44.cloudopencode

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.sikorokoro44.cloudopencode.data.network.CloudApiClientImpl
import com.sikorokoro44.cloudopencode.security.EncryptedTokenStore
import com.sikorokoro44.cloudopencode.ui.CloudOpenCodeApp
import com.sikorokoro44.cloudopencode.ui.CloudOpenCodeViewModel

class MainActivity : ComponentActivity() {
    private val client by lazy { CloudApiClientImpl(BuildConfig.CLOUD_BASE_URL, emptySet()) }
    private val tokenStore by lazy { EncryptedTokenStore(applicationContext) }
    private val viewModel: CloudOpenCodeViewModel by viewModels {
        viewModelFactory {
            initializer { CloudOpenCodeViewModel(client, tokenStore, applicationContext) }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        handleOAuthCallback(intent)
        setContent { CloudOpenCodeApp(viewModel) }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleOAuthCallback(intent)
    }

    private fun handleOAuthCallback(intent: Intent?) {
        val data = intent?.data ?: return
        if (data.scheme != "cloudopencode" || data.host != "github") return
        viewModel.handleGithubOAuthCallback(
            status = data.getQueryParameter("status"),
            error = data.getQueryParameter("error"),
        )
    }
}
