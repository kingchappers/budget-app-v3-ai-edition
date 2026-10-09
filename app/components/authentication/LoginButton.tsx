import { useAuth } from '~/lib/auth';
import { Button } from '@mantine/core';
import { IconUser } from "@tabler/icons-react";

const LoginButton = () => {
  const { login } = useAuth();
  return (
    <Button
      onClick={() => login()}
      color="text"
      leftSection={<IconUser size={16} />}
      variant="transparent"
    >
      Sign in
    </Button>
  );
};

export default LoginButton;
