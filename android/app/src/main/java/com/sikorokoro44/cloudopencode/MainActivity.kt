package com.sikorokoro44.cloudopencode

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.remember
import androidx.lifecycle.viewmodel.compose.viewModel
import com.sikorokoro44.cloudopencode.data.network.CloudApiClientImpl
import com.sikorokoro44.cloudopencode.security.EncryptedTokenStore
import com.sikorokoro44.cloudopencode.ui.CloudOpenCodeApp
import com.sikorokoro44.cloudopencode.ui.CloudOpenCodeViewModel

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            val client = remember { CloudApiClientImpl(BuildConfig.CLOUD_BASE_URL, emptySet()) }
            val tokenStore = remember { EncryptedTokenStore(this@MainActivity) }
            val viewModel = viewModel { CloudOpenCodeViewModel(client, tokenStore, this@MainActivity) }
            CloudOpenCodeApp(viewModel)
        }
    }
}
