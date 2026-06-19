import { SafeAreaView, Text, TouchableOpacity, View } from "react-native";
import { getMobileHomeActions } from "./src/homeModel";

export default function App() {
  return (
    <SafeAreaView>
      <View>
        <Text>GW-LINK OmniAI</Text>
        <Text>Text, image, and video AI creation on the go.</Text>
        {getMobileHomeActions().map((action) => (
          <TouchableOpacity key={action}>
            <Text>{action}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </SafeAreaView>
  );
}
