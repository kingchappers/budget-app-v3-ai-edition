import { useAuth0 } from "@auth0/auth0-react";
import { Button } from '@mantine/core';
import { IconUser } from "@tabler/icons-react";

const LoginButton = () => {
  const { loginWithRedirect } = useAuth0();
  return (
    <Button
      onClick={() => loginWithRedirect()}
      color="text"
      leftSection={<IconUser size={16} />}
      variant="transparent"
    >
      Log In
    </Button>
  );
};

export default LoginButton;
