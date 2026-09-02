import { StrictMode } from "react";
import { DefaultLayout } from "../components/layout/DefaultLayout";
import { ApiTest } from "../components/api/ApiTest";
import { Text } from '@mantine/core';

export default function Home() {
    return (
        <StrictMode>
            <DefaultLayout>
                <Text>The test has worked and you've created a new route to a test page under /test</Text>
                <div style={{ marginTop: '2rem' }}>
                    <ApiTest />
                </div>
            </DefaultLayout>
        </StrictMode>
    );
}
