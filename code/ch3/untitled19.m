% 初始化最大误差数组
MaxErr = zeros(4, 1);

for ii=1:4
    m = 10*2^(ii-1);
    n = 100*4^(ii-1);
    x1 = 0; x2 = 1; t1 = 0; t2 = 1;
    h = (x2-x1)/m; dt =(t2-t1)/n;
    x = linspace(x1, x2, m+1)'; % 使用linspace来生成等间距点
    t = linspace(t1, t2, n+1)';
    u = zeros(m+1, n+1);

    % 初始条件和边界条件
    u(:,1) = exp(x);
    u(1,:) = exp(t);
    u(m+1,:) = exp(1+t);

    r = dt /(h^2);
    
    % 构建矩阵A和B
    rowA = [5/6+r, 1/12-r/2];
    A = toeplitz([rowA(1), rowA(2), zeros(1,m-3)], [rowA(1), rowA(2), zeros(1,m-3)]);
    rowB = [5/6-r, 1/12+r/2];
    B = toeplitz([rowB(1), rowB(2), zeros(1,m-3)], [rowB(1), rowB(2), zeros(1,m-3)]);

    for k = 1:n
        H = zeros(m-1, 1);
        H(1) = (1/12+r/2) * u(1, k) -(1/12-r/2)*u(1, k+1);
        H(end) =(1/12+r/2) * u(m+1, k) -(1/12-r/2)*u(m+1, k+1);

        % 对每一层都进行QR分解，以确保数值稳定性
        [Q, R] = qr(B);  % Householder QR 分解
        
        % 确保 A*u(2:m, k) 和 H 的维度一致
        rhs = A * u(2:m, k) + H;  % 右端项
        
        % 确保 Q' 和 rhs 的维度一致
        b = Q' * rhs;  % 求解右端项
        u(2:m, k+1) = R\b;  % 回代求解上三角系统 Rx = b
    end

    % 计算误差
    [X, T] = meshgrid(x, t); % 创建网格数据
    F = exp(X + T); % 理论解
    error = abs(u - F');
    MaxErr(ii) = max(error(:));
end

% 输出最大误差和收敛阶数
for l=1:3
    disp(['Max Error for ii=', num2str(l), ': ', num2str(MaxErr(l))]);
end
for j=1:3 
    ord = log2(MaxErr(j)/MaxErr(j+1));
    if isfinite(ord) && ord > 0
        disp(['收敛阶 ',': ', num2str(ord)]);
    else
        disp('收敛阶未定义或为负，请检查代码');
    end
end