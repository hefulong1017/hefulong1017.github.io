function MaxErr = page161(M, N, p)

    format short e
    xa = 0; xb = 1; h = (xb - xa) / M;
    Ta = 0; Tb = 1; dt = (Tb - Ta) / N;
    x = xa:h:xb; x = x';
    t = Ta:dt:Tb; t = t';

    % 系数矩阵和边界条件
    a = 1; r = a * dt / h^2;
    u = zeros(M + 1, N + 1);
    u(:,1) = u1(x); % 初始条件
    u(1,:) = sqrt(2)/2 * exp(-t);
    u(M + 1,:) = sqrt(2)/2 * exp(-t);
    row = zeros(M - 1, 1); row(1, 1) = -2; row(2) = 1;
    A = toeplitz(row); I = eye(M - 1);

    % 计算第一层次
    U = 1 / 2 * (u1(x) + dt / 2 * ((u1(x)).^4 .* u2(x) + f3(x, 0))).^4;
    B = diag(U(2:M));
    H1 = zeros(M - 1, 1);
    H1(1) = r * U(2) * u(1, 2); 
    H1(M - 1) = r * U(M) * u(M + 1, 2);
    H2 = zeros(M - 1, 1);
    H2(1) = r * U(2) * u(1, 1); 
    H2(M - 1) = r * U(M) * u(M + 1, 1);
    t_half = (t(1) + t(2)) / 2;
    u(2:M,2) = (I - r * B * A) \ ((I + r * B * A) * u(2:M,1) + dt * f3(x(2:M), t_half) + H1 + H2);

    % 计算第 2 到 N 层次
    for k = 2:N
        C = diag(u(2:M, k).^4);
        H = zeros(M - 1, 1);
        H(1) = r * u(1, k + 1) * u(2, k).^4 + r * u(1, k - 1) * u(2, k).^4;
        H(M - 1) = r * u(M + 1, k + 1) * u(M, k).^4 + r * u(M + 1, k - 1) * u(M, k).^4;
        u(2:M, k + 1) = (I - r * C * A) \ (u(2:M, k - 1) + r * C * A * u(2:M, k - 1) + 2 * dt * f3(x(2:M), t(k)) + H);
    end

    % 计算误差和精确解
    T = zeros(M + 1, N + 1);
    for i = 1:M + 1
        for j = 1:N + 1
            T(i, j) = exp(-t(j)) * sin(pi / 4 + pi / 2 * x(i));
        end
    end
    Error = abs(u - T);
    MaxErr = max(max(Error));

    % 绘制图形
    if p == 1
        figure(1)
        mesh(u)
        xlabel('t'), ylabel('x'), zlabel('u(x,t)')
        
        figure(2)
        mesh(t(2:end - 1), x(2:end - 1), Error(2:end - 1, 2:end - 1))
        xlabel('t'), ylabel('x'), zlabel('Error')
        hold on
    end
end



