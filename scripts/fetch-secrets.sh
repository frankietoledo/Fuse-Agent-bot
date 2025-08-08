    #!/bin/bash
    aws secretsmanager get-secret-value --secret-id ec2-ssh-key --query SecretString --output text