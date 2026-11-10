// Entrada do app. A tarefa em segundo plano (preços do MYP) é definida antes de tudo: o Android pode abrir o app só
// para rodá-la, sem nenhuma tela, e ela precisa existir já na primeira leitura do código.
import './src/components/myp-background';
// Por último, como pede o Expo Router.
import 'expo-router/entry';
