package expo.modules.cardocr

import android.graphics.Rect
import android.net.Uri
import android.os.SystemClock
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.Text
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.TextRecognizer
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions
import com.google.mlkit.vision.text.japanese.JapaneseTextRecognizerOptions
import com.google.mlkit.vision.text.korean.KoreanTextRecognizerOptions
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class CardOcrModule : Module() {
  private val recognizers = HashMap<String, TextRecognizer>()

  private fun recognizerFor(script: String): TextRecognizer = synchronized(recognizers) {
    recognizers.getOrPut(script) {
      when (script) {
        "japanese" -> TextRecognition.getClient(JapaneseTextRecognizerOptions.Builder().build())
        "korean" -> TextRecognition.getClient(KoreanTextRecognizerOptions.Builder().build())
        "chinese" -> TextRecognition.getClient(ChineseTextRecognizerOptions.Builder().build())
        else -> TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
      }
    }
  }

  private fun box(r: Rect?): Map<String, Int>? =
    r?.let { mapOf("x" to it.left, "y" to it.top, "w" to it.width(), "h" to it.height()) }

  private fun lineOf(block: Int, line: Text.Line): Map<String, Any?> = mapOf(
    "text" to line.text,
    "block" to block,
    "box" to box(line.boundingBox),
    "angle" to line.angle.toDouble(),
    "confidence" to line.confidence.toDouble(),
    "lang" to line.recognizedLanguage,
    "words" to line.elements.map { mapOf("text" to it.text, "box" to box(it.boundingBox)) },
  )

  override fun definition() = ModuleDefinition {
    Name("CardOcr")

    AsyncFunction("recognize") { uri: String, script: String, promise: Promise ->
      val context = appContext.reactContext
        ?: return@AsyncFunction promise.reject("ERR_OCR_CONTEXT", "Aplicativo ainda não está pronto.", null)
      try {
        val image = InputImage.fromFilePath(context, Uri.parse(uri))
        val startedAt = SystemClock.elapsedRealtime()
        recognizerFor(script).process(image)
          .addOnSuccessListener { text ->
            val lines = text.textBlocks.flatMapIndexed { i, block -> block.lines.map { lineOf(i, it) } }
            promise.resolve(
              mapOf(
                "width" to image.width,
                "height" to image.height,
                "ms" to (SystemClock.elapsedRealtime() - startedAt).toInt(),
                "lines" to lines,
              ),
            )
          }
          .addOnFailureListener { e -> promise.reject("ERR_OCR", e.message ?: "Falha na leitura.", e) }
      } catch (e: Exception) {
        promise.reject("ERR_OCR_IMAGE", e.message ?: "Não abriu a imagem.", e)
      }
    }

    OnDestroy {
      synchronized(recognizers) {
        recognizers.values.forEach { it.close() }
        recognizers.clear()
      }
    }
  }
}
