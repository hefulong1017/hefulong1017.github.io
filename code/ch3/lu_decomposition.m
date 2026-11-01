function [L, U] = lu_decomposition(A)
    n = size(A, 1);
    L = eye(n);  % 初始化单位下三角矩阵
    U = zeros(n);  % 初始化上三角矩阵
    
    for k = 1:n
        % 更新U的第k行
        U(k, k:n) = A(k, k:n);
        
        % 更新L的第k列
        if k < n
            L(k+1:n, k) = A(k+1:n, k) / A(k, k);
        end
        
        % 更新剩余元素
        for i = k+1:n
            for j = k+1:n
                A(i, j) = A(i, j) - L(i, k) * U(k, j);
            end
        end
    end
end