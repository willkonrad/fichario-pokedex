# Leituras reais de OCR

Cada `.json` desta pasta é uma leitura exportada pela tela `/ocr-probe` do APK, mais o campo `expect` com o que a carta
tem impresso. O teste `tests/card-ocr.test.ts` lê todos os arquivos daqui e confere só os campos que estiverem em `expect`.

```json
{
  "script": "latin",
  "captureMs": 412,
  "result": { "width": 3024, "height": 4032, "ms": 180, "lines": [{ "text": "Umbreon", "box": { "x": 1, "y": 2, "w": 3, "h": 4 }, "angle": 0 }] },
  "expect": { "speciesId": 197, "hp": 110, "num": "070/108", "setCode": "m2a", "langTag": null }
}
```

Campos de `expect`: `name`, `speciesId`, `speciesFrom`, `hp`, `hpWord`, `num` (`"070/108"`; sem total, `"SWSH123/"`), `setCode`,
`langTag`, `regulation`, `year`, `langWords`, `level`, `script`. Sem `expect`, o arquivo só confere que a leitura não quebra.

O nome do arquivo diz a carta e o jeito de fotografar: `pt-umbreon-sleeve.json`, `jp-pikachu-m6a-toploader.json`.

`exemplo-sintetico.json` foi montado à mão, só para garantir que o teste percorre a pasta. Não é leitura de aparelho.
