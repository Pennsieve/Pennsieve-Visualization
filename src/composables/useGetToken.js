
import { fetchAuthSession } from "@aws-amplify/auth";


export async function useGetToken() {
    try {
        return fetchAuthSession().then((session) => {
            return session?.tokens?.accessToken.toString();
            }
        );
    } catch (error) {
        console.error(error);
    }
}
