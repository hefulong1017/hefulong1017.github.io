for ii = 1:4
    m = 10 * 2^(ii-1);
    n = 100 * 4^(ii-1);
    x1 = 0; x2 = 1; t1 = 0; t2 = 1;
    h = (x2 - x1) / m;
    dt = (t2 - t1) / n;
    x = x1 : h : x2;
    t = t1 : dt : t2;
    u = zeros(m+1, n+1);

    % 初始条件和边界条件
    u(:, 1) = exp(x);
    u(1, :) = exp(t);
    u(m+1, :) = exp(1 + t);

    r = dt / (h^2);

    % 手动创建频率向量
    k = 2 * pi * [0:(m/2-1), -m/2:-1] / (m * h);

    % 时间步进
    for k_time = 1:n
        % 当前时刻的解
        u_fft = fft(u(2:end-1, k_time));

        % 构建右边项
        H = zeros(m-1, 1);
        H(1, 1) = (1/12 + r/2) * u(1, k_time) - (1/12 - r/2) * u(1, k_time+1);
        H(m-1, 1) = (1/12 + r/2) * u(m+1, k_time) - (1/12 - r/2) * u(m+1, k_time+1);

        % 计算下一时刻的解
        u_next_fft = u_fft ./ (1 + r * k.^2) .* (1 - r * k.^2 * u_fft + fft(H));

        % 反变换回空间域
        u(2:end-1, k_time+1) = real(ifft(u_next_fft));
    end

    % 计算误差
    F = zeros(m+1, n+1);
    for i = 1:m+1
        for j = 1:n+1
            F(i, j) = exp(x(i) + t(j));
        end
    end
    error = abs(u - F);
    MaxErr(ii) = max(max(error));

    % 绘图
    figure(1)
    plot(x, u(:, n+1));
    hold on;
    figure(2)
    plot(x, F(:, n+1));
    hold on;
    figure(3)
    plot(x, abs(u(:, n+1) - F(:, n+1)));
    hold on;
end

% 输出最大误差
for l = 1:3
    disp(MaxErr(l));
end

% 计算收敛阶
for j = 1:3
    ord = MaxErr(j) / MaxErr(j+1);
    disp(['收敛阶: ', num2str(ord)]);
end