% 空间和时间离散参数
L = 10; % 空间区间长度
T = 5; % 总时间
nx_vec = [50, 100, 200, 400]; % 不同的空间网格点数向量，用于收敛阶分析
nt_vec = [250, 500, 1000, 2000]; % 不同的时间步数向量，用于收敛阶分析
c = 1; % 波速

% 用于存储不同离散尺度下的误差（用于收敛阶计算）
errors_nx = zeros(length(nx_vec), 1);
errors_nt = zeros(length(nt_vec), 1);

% 循环计算不同空间离散尺度下的解和误差
for i = 1:length(nx_vec)
    nx = nx_vec(i);
    dx = L / (nx - 1);
    nt = 1000; % 固定时间步数（可以根据情况调整，这里保证时间足够精确来主要分析空间离散影响）
    dt = T / nt;
    
    % 初始化空间网格和初始条件
    x = linspace(0, L, nx)';
    u = zeros(nx, nt);
    u(:, 1) = exp(-(x - 5).^2); % 初始位移分布
    
    % 构造二阶中心差分格式的系数矩阵用于空间二阶导数
    e = ones(nx, 1);
    A = spdiags([e -2*e e], [-1 0 1], nx, nx) / dx^2;
    
    % 时间推进循环
    for n = 2:nt
        % 对当前时间步的位移进行FFT
        U_hat = fft(u(:, n - 1));
        % 应用波动方程在频域的解（考虑到边界条件等）
        omega = (2 * pi / L) * [0:(nx / 2 - 1) (-nx / 2):-1]'; % 波数向量
        factor = -c^2 * omega.^2 * dt^2;
        U_hat = (1 + factor / 2)./(1 - factor / 2).* U_hat;
        % 进行逆FFT回到空间域得到下一个时间步的位移
        u(:, n) = real(ifft(U_hat));
    end
    
    % 计算精确解
    t = (0:nt - 1)' * dt;
    u_exact = cos(2 * pi * (x - c * t));
    % 计算误差（这里用L2范数误差为例）
    errors_nx(i) = sqrt(sum(sum((u - u_exact).^2)) / (nx * nt));
end

% 循环计算不同时间离散尺度下的解和误差
for i = 1:length(nt_vec)
    nt = nt_vec(i);
    dt = T / nt;
    nx = 200; % 固定空间网格点数（可以根据情况调整，这里保证空间足够精确来主要分析时间离散影响）
    dx = L / (nx - 1);
    
    % 初始化空间网格和初始条件
    x = linspace(0, L, nx)';
    u = zeros(nx, nt);
    u(:, 1) = exp(-(x - 5).^2); % 初始位移分布
    
    % 构造二阶中心差分格式的系数矩阵用于空间二阶导数
    e = ones(nx, 1);
    A = spdiags([e -2*e e], [-1 0 1], nx, nx) / dx^2;
    
    % 时间推进循环
    for n = 2:nt
        % 对当前时间步的位移进行FFT
        U_hat = fft(u(:, n - 1));
        % 应用波动方程在频域的解（考虑到边界条件等）
        omega = (2 * pi / L) * [0:(nx / 2 - 1) (-nx / 2):-1]'; % 波数向量
        factor = -c^2 * omega.^2 * dt^2;
        U_hat = (1 + factor / 2)./(1 - factor / 2).* U_hat;
        % 进行逆FFT回到空间域得到下一个时间步的位移
        u(:, n) = real(ifft(U_hat));
    end
    
    % 计算精确解
    t = (0:nt - 1)' * dt;
    u_exact = cos(2 * pi * (x - c * t));
    % 计算误差（这里用L2范数误差为例）
    errors_nt(i) = sqrt(sum(sum((u - u_exact).^2)) / (nx * nt));
end

% 绘制数值解收敛阶曲线（空间离散）
loglog(nx_vec, errors_nx, 'o-', 'LineWidth', 1.5);
hold on;
p = polyfit(log(nx_vec), log(errors_nx), 1); % 拟合直线求斜率（收敛阶）
loglog(nx_vec, exp(polyval(p, log(nx_vec))), 'r--', 'LineWidth', 1.5);
title('Convergence Order (Spatial Discretization)');
xlabel('Number of Spatial Grid Points (nx)');
ylabel('Error (L2 Norm)');
legend('Numerical Error', 'Fitted Order');
hold off;

% 绘制数值解收敛阶曲线（时间离散）
figure;
loglog(nt_vec, errors_nt, 'o-', 'LineWidth', 1.5);
hold on;
p = polyfit(log(nt_vec), log(errors_nt), 1); % 拟合直线求斜率（收敛阶）
loglog(nt_vec, exp(polyval(p, log(nt_vec))), 'r--', 'LineWidth', 1.5);
title('Convergence Order (Temporal Discretization)');
xlabel('Number of Time Steps (nt)');
ylabel('Error (L2 Norm)');
legend('Numerical Error', 'Fitted Order');
hold off;

% 重新计算一个固定离散尺度下的误差曲面（以nx=100, nt=500为例）
nx = 100;
nt = 500;
dx = L / (nx - 1);
dt = T / nt;
x = linspace(0, L, nx)';
u = zeros(nx, nt);
u(:, 1) = exp(-(x - 5).^2); % 初始位移分布
% 构造二阶中心差分格式的系数矩阵用于空间二阶导数
e = ones(nx, 1);
A = spdiags([e -2*e e], [-1 0 1], nx, nx) / dx^2;
for n = 2:nt
    % 对当前时间步的位移进行FFT
    U_hat = fft(u(:, n - 1));
    % 应用波动方程在频域的解（考虑到边界条件等）
    omega = (2 * pi / L) * [0:(nx / 2 - 1) (-nx / 2):-1]'; % 波数向量
    factor = -c^2 * omega.^2 * dt^2;
    U_hat = (1 + factor / 2)./(1 - factor / 2).* U_hat;
    % 进行逆FFT回到空间域得到下一个时间步的位移
    u(:, n) = real(ifft(U_hat));
end
t = (0:nt - 1)' * dt;
u_exact = cos(2 * pi * (x - c * t));
errors = (u - u_exact).^2; % 误差矩阵

% 绘制误差曲面
figure;
[X, T] = meshgrid(x, t);
surf(X, T, errors);
title('Error Surface');
xlabel('x');
ylabel('t');
zlabel('Error');